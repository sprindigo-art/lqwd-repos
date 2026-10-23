#!/usr/bin/env python3
"""collect_telemetry.py - NodeMonitor (TEL-01/02/03) node-side telemetry collector.

Third clone of the Phase-8 rail (mirrors the live-fleet nodeAuditor main.py:
psycopg2 + python-dotenv, venv-run, direct INSERT). Each */5 tick this payload:
  1. SELECTs service_inventory to drive the per-service detection map.
  2. Gathers host vitals (/proc + df) as RAW values (D-14 - no thresholds here).
  3. Grades two-axis service health (RUNNING + FUNCTIONING) per inventory row.
  4. (Task 2) probes bitcoind/esplora/postgres, then INSERTs one tick across the
     four nodemon fact tables under host-scoped RLS and prunes the 21-day window.

SECURITY (D-03 / D-11):
  * NO secret literal ships in this payload. The telemetry DSN + bitcoind/pg
    credentials come from the root-only env file sourced at runtime - never here.
  * ALL subprocesses run via argv (a list), NEVER a shell string (EXEC-02).
  * RAW observed values only - staleness/severity/blocks-behind are derived at
    read time (D-13/D-14), never stored.
"""

import os
import re
import sys
import glob
import gzip
import json
import time
import base64
import socket
import hashlib
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timezone

try:
    import psycopg2
except ImportError:  # allow offline import (test_extract.py) without the driver;
    psycopg2 = None  # main() fail-fasts below when a live tick actually needs it.

try:
    from dotenv import load_dotenv
except ImportError:  # dotenv installed by the wrapper's bootstrap; tolerate absence at import time.
    load_dotenv = None

# Root-only env file pre-placed out-of-band by provisioning (D-03). Holds the
# nodemon_telemetry DSN + bitcoind/pg credentials + LNCLI. NEVER shipped via scp.
DEFAULT_ENV_FILE = "/lnd/nodemon/.nodemon.env"
DSN_ENV = "NODEMON_TELEMETRY_DSN"

# COLLECTOR_VERSION — a per-tick build fingerprint logged (NOT written to the
# warehouse) so a promotion is auditable in collect-telemetry.log: which build ran
# on which node at which tick (T-16-11 observability). Bump on every payload change.
# The collector stays SELECT-only — this marker never becomes a warehouse row.
COLLECTOR_VERSION = "16.07"

# Two distinct freshness clocks (RESEARCH Pitfall 1): the per-service interval
# below judges FUNCTIONING freshness, NOT the 15-min collector clock. grace lets
# a tick land a little late without false-alarming a healthy schedule.
FRESHNESS_GRACE = 3
DEFAULT_INTERVAL_SECONDS = 300

# COL-04 cursor constants. INITIAL_TAIL_BYTES is the demoted former LOG_TAIL_BYTES:
# it is now the FIRST-SIGHT bootstrap window ONLY (a fresh path seeds a recent tail,
# never the full historical log). MAX_BYTES_PER_TICK caps a single tick's read so a
# burst cannot make one tick read unbounded memory (T-16-07) — the remainder is
# LOGGED and deferred to the next tick. CURSOR_FILE is LOCAL node state (never the
# warehouse), preserving the collector's SELECT-only boundary (T-16-04).
INITIAL_TAIL_BYTES = 65536  # first-sight bootstrap window only (was LOG_TAIL_BYTES)
# MAX_BYTES_PER_TICK — per-tick read ceiling (T-16-07). Operator-confirmed at the
# 8 MB default (A1, 2026-07-16): a single tick reads at most 8 MB of new log bytes;
# the remainder is LOGGED and deferred to the next tick so a burst cannot make one
# tick read unbounded memory. Tunable per node via env if a host proves noisier.
MAX_BYTES_PER_TICK = 8 * 1024 * 1024  # [CONFIRMED A1 2026-07-16] 8 MB per-tick ceiling
CURSOR_FILE = "/lnd/nodemon/.log-cursors.json"


def log(message):
    """Timestamped stdout line (cron redirect captures it into the log file)."""
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}: {message}", flush=True)


# ─────────────────────────────────────────────────────────────────────
# subprocess - argv ONLY, never shell-string (EXEC-02 injection rule)
# ─────────────────────────────────────────────────────────────────────
def run_argv(argv, timeout=10):
    """Run a command via argv (list). Returns (returncode, stdout, stderr)."""
    try:
        proc = subprocess.run(
            argv, capture_output=True, text=True, timeout=timeout, check=False
        )
        return proc.returncode, proc.stdout, proc.stderr
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as exc:
        return 1, "", str(exc)


# ─────────────────────────────────────────────────────────────────────
# Identity derivation (D-04 RLS axes)
# ─────────────────────────────────────────────────────────────────────
def resolve_host_id():
    """host_id = explicit env override else the hostname (OQ-6 recommendation)."""
    explicit = os.environ.get("NODEMON_HOST_ID")
    if explicit:
        return explicit.strip()
    return socket.gethostname()


def resolved_lncli_path():
    """The lncli binary the collector will invoke (env LNCLI, else bare `lncli`).

    A bare `lncli` under a thin cron/root PATH resolves to nothing -> pubkey=none ->
    node-scoped rows RLS-skipped. deploy-env.sh pins LNCLI to the absolute wrapper
    (/lnd/bashScripts/lncli-telemetry.sh) so this is diagnosable per tick (T-16-09).
    """
    return os.environ.get("LNCLI", "lncli")


def resolve_node_pubkey():
    """node_pubkey from `lncli getinfo`.identity_pubkey; None if underivable."""
    lncli = resolved_lncli_path()
    rc, out, _ = run_argv([lncli, "getinfo"], timeout=15)
    if rc != 0 or not out:
        return None
    try:
        return json.loads(out).get("identity_pubkey") or None
    except (ValueError, TypeError):
        return None


# ─────────────────────────────────────────────────────────────────────
# Host vitals (TEL-01) - RAW values from procfs + df (D-14)
# ─────────────────────────────────────────────────────────────────────
def _read_cpu_times():
    """Sum of jiffies + idle (idle + iowait) from the aggregate /proc/stat line."""
    with open("/proc/stat", encoding="utf-8") as handle:
        fields = handle.readline().split()
    vals = [int(x) for x in fields[1:]]
    idle = vals[3] + (vals[4] if len(vals) > 4 else 0)
    return sum(vals), idle


def gather_cpu_pct():
    """Busy % over a ~1s window (two /proc/stat reads); None if unreadable."""
    try:
        total1, idle1 = _read_cpu_times()
        time.sleep(1)
        total2, idle2 = _read_cpu_times()
    except (OSError, ValueError):
        return None
    delta_total = total2 - total1
    if delta_total <= 0:
        return None
    busy = (delta_total - (idle2 - idle1)) / delta_total * 100.0
    return round(busy, 2)


def gather_loadavg():
    """1/5/15-minute load averages from /proc/loadavg; (None,None,None) on error."""
    try:
        with open("/proc/loadavg", encoding="utf-8") as handle:
            parts = handle.read().split()
        return float(parts[0]), float(parts[1]), float(parts[2])
    except (OSError, ValueError, IndexError):
        return None, None, None


def gather_meminfo():
    """Memory detail in kB (raw) from /proc/meminfo. Extended for COL-03 with
    Cached/Buffers/Dirty/Writeback/Slab/SReclaimable (host_metrics_ext scalars);
    the original four keys still feed host_metrics unchanged."""
    wanted = {
        "MemTotal": None, "MemAvailable": None, "SwapTotal": None, "SwapFree": None,
        "Cached": None, "Buffers": None, "Dirty": None, "Writeback": None,
        "Slab": None, "SReclaimable": None,
    }
    try:
        with open("/proc/meminfo", encoding="utf-8") as handle:
            for line in handle:
                key = line.split(":", 1)[0]
                if key in wanted:
                    wanted[key] = int(line.split()[1])  # value is in kB
    except (OSError, ValueError, IndexError):
        pass
    return wanted


def gather_uptime():
    """Uptime seconds (int) from /proc/uptime; None on error."""
    try:
        with open("/proc/uptime", encoding="utf-8") as handle:
            return int(float(handle.read().split()[0]))
    except (OSError, ValueError, IndexError):
        return None


def gather_net_bytes():
    """Cumulative rx/tx bytes summed over non-loopback ifaces (/proc/net/dev)."""
    rx_total = 0
    tx_total = 0
    try:
        with open("/proc/net/dev", encoding="utf-8") as handle:
            lines = handle.readlines()[2:]  # skip the two header rows
        for line in lines:
            name, _, stats = line.partition(":")
            if name.strip() == "lo":
                continue
            cols = stats.split()
            if len(cols) >= 9:
                rx_total += int(cols[0])
                tx_total += int(cols[8])
    except (OSError, ValueError, IndexError):
        return None, None
    return rx_total, tx_total


def gather_host_metrics():
    """One host_metrics row's worth of RAW vitals."""
    mem = gather_meminfo()
    load1, load5, load15 = gather_loadavg()
    rx_bytes, tx_bytes = gather_net_bytes()
    return {
        "cpu_pct": gather_cpu_pct(),
        "load_1": load1,
        "load_5": load5,
        "load_15": load15,
        "mem_total_kb": mem["MemTotal"],
        "mem_available_kb": mem["MemAvailable"],
        "swap_total_kb": mem["SwapTotal"],
        "swap_free_kb": mem["SwapFree"],
        "uptime_seconds": gather_uptime(),
        "net_rx_bytes": rx_bytes,
        "net_tx_bytes": tx_bytes,
    }


def _parse_df_inodes(text):
    """Parse `df -i -P` output -> {mount_point: (inodes_total, inodes_used,
    inodes_free)}. Pure parse (COL-03; unit-tested offline)."""
    inodes = {}
    for line in (text or "").splitlines()[1:]:  # skip the df header line
        cols = line.split()
        if len(cols) < 6:
            continue
        try:
            itotal, iused, ifree = int(cols[1]), int(cols[2]), int(cols[3])
        except ValueError:
            continue
        inodes[cols[5]] = (itotal, iused, ifree)
    return inodes


def gather_host_storage():
    """One host_storage row per mounted filesystem via `df -P -B1` (raw bytes),
    plus inode counts from `df -i -P` (COL-03 additive; nullable if unavailable)."""
    rc, out, _ = run_argv(["df", "-P", "-B1"])
    rows = []
    if rc != 0 or not out:
        return rows
    rc_i, out_i, _ = run_argv(["df", "-i", "-P"])
    inodes = _parse_df_inodes(out_i) if rc_i == 0 else {}
    for line in out.splitlines()[1:]:  # skip the df header line
        cols = line.split()
        if len(cols) < 6:
            continue
        try:
            total = int(cols[1])
        except ValueError:
            continue
        if total <= 0:  # skip pseudo filesystems with no capacity
            continue
        itotal, iused, ifree = inodes.get(cols[5], (None, None, None))
        rows.append(
            {
                "mount_point": cols[5],
                "total_bytes": total,
                "used_bytes": int(cols[2]),
                "avail_bytes": int(cols[3]),
                "inodes_total": itotal,
                "inodes_used": iused,
                "inodes_free": ifree,
            }
        )
    return rows


# ─────────────────────────────────────────────────────────────────────
# Deep-VM metrics (COL-03) - RAW counters/gauges from /proc + argv-only
# tools (D-14: rate math happens at read time, never here). Every parse
# helper below is PURE (text in -> dict/list out) so test_extract.py can
# exercise it offline against fixture text; the gather_* wrappers add the
# defensive except (OSError, ValueError, IndexError) -> None/[] shape.
# ─────────────────────────────────────────────────────────────────────
def _read_file(path):
    """Whole-file read; None on any OS error (honest no-data)."""
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return None


def _parse_proc_stat_scalars(text):
    """ctxt/intr/procs_running/procs_blocked/btime from /proc/stat text."""
    out = {"ctxt": None, "intr": None, "procs_running": None,
           "procs_blocked": None, "btime": None}
    for line in (text or "").splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] in out:
            try:
                out[parts[0]] = int(parts[1])  # intr: first field = total
            except ValueError:
                pass
    return out


def _parse_cpu_cores(text):
    """Per-core jiffies from /proc/stat `cpu0..cpuN` lines. Full-line field
    layout: [0]=cpuN [1]=user [2]=nice [3]=system [4]=idle [5]=iowait [6]=irq
    [7]=softirq [8]=steal [9]=guest - steal is read from line index 8."""
    cores = []
    for line in (text or "").splitlines():
        parts = line.split()
        if not parts or not re.fullmatch(r"cpu\d+", parts[0]):
            continue
        try:
            vals = [int(x) for x in parts[1:]]
        except ValueError:
            continue

        def _field(idx):
            return vals[idx] if len(vals) > idx else None

        cores.append(
            {
                "core_index": int(parts[0][3:]),
                "user_jiffies": _field(0),
                "nice_jiffies": _field(1),
                "system_jiffies": _field(2),
                "idle_jiffies": _field(3),
                "iowait_jiffies": _field(4),
                "irq_jiffies": _field(5),
                "softirq_jiffies": _field(6),
                "steal_jiffies": _field(7),  # = full split-line index 8
                "guest_jiffies": _field(8),
            }
        )
    return cores


def _parse_vmstat(text):
    """pgfault/pgmajfault/pswpin/pswpout/oom_kill counters from /proc/vmstat."""
    wanted = {"pgfault": None, "pgmajfault": None, "pswpin": None,
              "pswpout": None, "oom_kill": None}
    for line in (text or "").splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0] in wanted:
            try:
                wanted[parts[0]] = int(parts[1])
            except ValueError:
                pass
    return wanted


def _parse_snmp_tcp(text):
    """Tcp: counters from /proc/net/snmp (header line zipped with value line)."""
    out = {"tcp_retrans_segs": None, "tcp_out_segs": None, "tcp_in_segs": None,
           "tcp_active_opens": None, "tcp_attempt_fails": None}
    header = None
    for line in (text or "").splitlines():
        if not line.startswith("Tcp:"):
            continue
        parts = line.split()
        if header is None:
            header = parts[1:]
            continue
        try:
            values = dict(zip(header, (int(x) for x in parts[1:])))
        except ValueError:
            return out
        out["tcp_retrans_segs"] = values.get("RetransSegs")
        out["tcp_out_segs"] = values.get("OutSegs")
        out["tcp_in_segs"] = values.get("InSegs")
        out["tcp_active_opens"] = values.get("ActiveOpens")
        out["tcp_attempt_fails"] = values.get("AttemptFails")
        break
    return out


def _parse_file_nr(text):
    """(fd_allocated, fd_max) from /proc/sys/fs/file-nr (3 fields)."""
    parts = (text or "").split()
    if len(parts) < 3:
        return None, None
    try:
        return int(parts[0]), int(parts[2])
    except ValueError:
        return None, None


def _parse_ss_summary(text):
    """sockets_total/tcp_estab/tcp_time_wait from `ss -s` output."""
    out = {"sockets_total": None, "tcp_estab": None, "tcp_time_wait": None}
    for line in (text or "").splitlines():
        m = re.match(r"Total:\s+(\d+)", line)
        if m:
            out["sockets_total"] = int(m.group(1))
            continue
        if line.startswith("TCP:"):
            m = re.search(r"estab (\d+)", line)
            if m:
                out["tcp_estab"] = int(m.group(1))
            m = re.search(r"timewait (\d+)", line)
            if m:
                out["tcp_time_wait"] = int(m.group(1))
    return out


def _parse_chronyc_tracking(text):
    """Signed offset seconds from `chronyc tracking` ("System time" line).
    Positive = system clock fast of NTP; negative = slow. None if unparseable."""
    for line in (text or "").splitlines():
        if not line.startswith("System time"):
            continue
        m = re.search(r":\s*([0-9.]+) seconds (fast|slow)", line)
        if not m:
            return None
        offset = float(m.group(1))
        return offset if m.group(2) == "fast" else -offset
    return None


def _parse_diskstats(text):
    """Per-device I/O counters from /proc/diskstats. 1-based fields: fld4 reads
    completed, fld6 sectors read (512B), fld8 writes completed, fld10 sectors
    written, fld12 I/Os in progress, fld13 ms doing I/O. Only the true pseudo
    devices (loop*/ram*) are filtered out; dm-* (LVM/LUKS device-mapper) volumes
    ARE captured so root/data I/O on dm-backed hosts is not silently dropped
    (IN-02)."""
    rows = []
    for line in (text or "").splitlines():
        parts = line.split()
        if len(parts) < 13:
            continue
        device = parts[2]
        if re.match(r"^(loop|ram)", device):
            continue
        try:
            rows.append(
                {
                    "device": device,
                    "reads_completed": int(parts[3]),     # fld4
                    "sectors_read": int(parts[5]),        # fld6
                    "writes_completed": int(parts[7]),    # fld8
                    "sectors_written": int(parts[9]),     # fld10
                    "ios_in_progress": int(parts[11]),    # fld12
                    "ms_doing_io": int(parts[12]),        # fld13
                }
            )
        except ValueError:
            continue
    return rows


def _parse_net_dev_ifaces(text):
    """Per-iface rx/tx bytes + errs/drops/colls from /proc/net/dev (skip `lo`).
    rx cols: bytes(0) errs(2) drop(3); tx cols: bytes(8) errs(10) drop(11) colls(13)."""
    rows = []
    lines = (text or "").splitlines()[2:]  # skip the two header rows
    for line in lines:
        name, sep, stats = line.partition(":")
        if not sep:
            continue
        iface = name.strip()
        if iface == "lo":
            continue
        cols = stats.split()
        if len(cols) < 14:
            continue
        try:
            rows.append(
                {
                    "iface": iface,
                    "rx_bytes": int(cols[0]),
                    "rx_errs": int(cols[2]),
                    "rx_drop": int(cols[3]),
                    "tx_bytes": int(cols[8]),
                    "tx_errs": int(cols[10]),
                    "tx_drop": int(cols[11]),
                    "tx_colls": int(cols[13]),
                }
            )
        except ValueError:
            continue
    return rows


def gather_cpu_cores():
    """One host_cpu_core row dict per `cpuN` line in /proc/stat (RAW jiffies)."""
    try:
        text = _read_file("/proc/stat")
        return _parse_cpu_cores(text) if text else []
    except (OSError, ValueError, IndexError):
        return []


def gather_disk_io():
    """One host_disk_io row dict per real block device in /proc/diskstats."""
    try:
        text = _read_file("/proc/diskstats")
        return _parse_diskstats(text) if text else []
    except (OSError, ValueError, IndexError):
        return []


def gather_net_ifaces():
    """One host_net_iface row dict per non-loopback iface in /proc/net/dev."""
    try:
        text = _read_file("/proc/net/dev")
        return _parse_net_dev_ifaces(text) if text else []
    except (OSError, ValueError, IndexError):
        return []


def gather_clock_offset():
    """Clock offset seconds via `chronyc tracking`, falling back to `ntpq -c rv`
    offset (ms -> s). None when neither tool is present/parseable (honest
    no-data, A2) - absence must NEVER crash the tick."""
    rc, out, _ = run_argv(["chronyc", "tracking"])
    if rc == 0 and out:
        offset = _parse_chronyc_tracking(out)
        if offset is not None:
            return offset
    rc, out, _ = run_argv(["ntpq", "-c", "rv"])
    if rc == 0 and out:
        m = re.search(r"offset=(-?[0-9.]+)", out)
        if m:
            try:
                return float(m.group(1)) / 1000.0  # ntpq reports milliseconds
            except ValueError:
                return None
    return None


def gather_host_metrics_ext():
    """One host_metrics_ext row's worth of RAW deep-VM scalars (COL-03).
    Every sub-source degrades independently to None (honest no-data)."""
    ext = {}
    try:
        ext.update(_parse_proc_stat_scalars(_read_file("/proc/stat")))
    except (OSError, ValueError, IndexError):
        ext.update({"ctxt": None, "intr": None, "procs_running": None,
                    "procs_blocked": None, "btime": None})
    mem = gather_meminfo()
    ext["cached_kb"] = mem.get("Cached")
    ext["buffers_kb"] = mem.get("Buffers")
    ext["dirty_kb"] = mem.get("Dirty")
    ext["writeback_kb"] = mem.get("Writeback")
    ext["slab_kb"] = mem.get("Slab")
    ext["sreclaimable_kb"] = mem.get("SReclaimable")
    try:
        ext.update(_parse_vmstat(_read_file("/proc/vmstat")))
    except (OSError, ValueError, IndexError):
        ext.update({"pgfault": None, "pgmajfault": None, "pswpin": None,
                    "pswpout": None, "oom_kill": None})
    try:
        ext.update(_parse_snmp_tcp(_read_file("/proc/net/snmp")))
    except (OSError, ValueError, IndexError):
        ext.update({"tcp_retrans_segs": None, "tcp_out_segs": None,
                    "tcp_in_segs": None, "tcp_active_opens": None,
                    "tcp_attempt_fails": None})
    try:
        fd_allocated, fd_max = _parse_file_nr(_read_file("/proc/sys/fs/file-nr"))
    except (OSError, ValueError, IndexError):
        fd_allocated, fd_max = None, None
    ext["fd_allocated"] = fd_allocated
    ext["fd_max"] = fd_max
    rc, out, _ = run_argv(["ss", "-s"])
    ext.update(_parse_ss_summary(out) if rc == 0 and out else
               {"sockets_total": None, "tcp_estab": None, "tcp_time_wait": None})
    rc, out, _ = run_argv(["systemctl", "--failed", "--no-legend"])
    ext["failed_units_count"] = (
        len([ln for ln in out.splitlines() if ln.strip()]) if rc == 0 else None
    )
    ext["clock_offset_seconds"] = gather_clock_offset()
    rc, out, _ = run_argv(["nproc"])
    try:
        ext["nproc"] = int(out.strip()) if rc == 0 and out.strip() else None
    except ValueError:
        ext["nproc"] = None
    try:
        entropy = _read_file("/proc/sys/kernel/random/entropy_avail")
        ext["entropy_avail"] = int(entropy.strip()) if entropy else None
    except (OSError, ValueError):
        ext["entropy_avail"] = None
    return ext


# ─────────────────────────────────────────────────────────────────────
# Two-axis service health (TEL-02)
# RUNNING archetypes (D-05): persistent proc -> pgrep; cron batch -> log-mtime
# (NEVER pgrep a cron-batch, Pitfall 2); systemd daemon -> systemctl is-active.
# FUNCTIONING (D-06): log mtime freshness + success/error grep markers.
# Infra-trio "native" probes are wired in Task 2.
# ─────────────────────────────────────────────────────────────────────
def _artifact_mtime(path):
    """(epoch, aware-datetime) of a file's mtime, or (None, None) if absent."""
    if not path or not os.path.exists(path):
        return None, None
    epoch = os.path.getmtime(path)
    return epoch, datetime.fromtimestamp(epoch, tz=timezone.utc)


# ─────────────────────────────────────────────────────────────────────
# Source-agnostic log cursor (COL-04 / D-09). read_since reads offset->EOF
# each tick (replacing the fixed INITIAL_TAIL_BYTES tail) so an [ERR] early
# in a 5-minute interval is never scrolled past. The cursor is a plain
# JSON-serializable dict keyed by a STABLE source_key (the service name, NOT
# the path — so a Postgres day-roll survives), holding {path,inode,offset,size}.
#
# Algorithm modeled faithfully on pygtail's proven inode+offset+size-shrink
# tailer [SOURCE: github.com/bgreenlee/pygtail core.py] — reimplemented, NOT
# vendored (the per-node venv stays psycopg2-binary + python-dotenv only).
#
# The cursor lives in /lnd/nodemon/.log-cursors.json (LOCAL node state) written
# atomically via os.replace — the collector never writes the cursor to the
# warehouse, preserving its SELECT-only boundary (T-16-04).
# ─────────────────────────────────────────────────────────────────────
def resolve_artifact(artifact_path):
    """Resolve an inventory artifact_path to a concrete file.

    A glob metacharacter (Postgres `postgresql-*.log`) or a directory resolves
    to the NEWEST matching file by mtime; a plain path is returned verbatim.
    Returns the original value when nothing resolves (caller handles absence).
    """
    if not artifact_path:
        return artifact_path
    if os.path.isdir(artifact_path):
        candidates = glob.glob(os.path.join(artifact_path, "*"))
    elif any(ch in artifact_path for ch in "*?["):
        candidates = glob.glob(artifact_path)
    else:
        return artifact_path
    files = [p for p in candidates if os.path.isfile(p)]
    if not files:
        return artifact_path
    return max(files, key=os.path.getmtime)


def read_since(source_key, path, cursors):
    """Read new complete lines from `path` since the saved cursor.

    Returns (lines, updated_cursors). Only complete newline-terminated lines are
    emitted; the offset parks at the start of any trailing partial line (Pitfall
    2). On first sight the offset seeds a recent tail (size - INITIAL_TAIL_BYTES),
    never the full history (Pitfall 1). An inode change OR a size shrink below the
    saved offset is treated as rotation -> reset to 0 (Pattern 2). A per-tick read
    is bounded by MAX_BYTES_PER_TICK with a LOGGED truncation and the remainder
    deferred to the next tick (COL-04, T-16-07).
    """
    prev = cursors.get(source_key)
    try:
        st = os.stat(path)
    except OSError:
        # Source no longer resolves: prune its stale entry (Pitfall 8) so the
        # cursor file cannot grow unbounded with vanished day-roll paths.
        if prev is not None:
            cursors = dict(cursors)
            cursors.pop(source_key, None)
        return [], cursors

    prepend = []
    with open(path, "rb") as fh:
        if prev and prev.get("inode") == st.st_ino and st.st_size >= prev["offset"]:
            start = prev["offset"]  # resume from the saved offset
        elif prev and (prev.get("inode") != st.st_ino or st.st_size < prev["offset"]):
            # ROTATION (new inode under a stable name) or truncation (size shrink):
            # drain the prior file's tail (Pattern 2) BEFORE resetting to the head
            # so no line straddling the boundary is lost (Pitfall 3).
            prepend = _drain_previous(path, prev)
            start = 0
        else:
            # First sight: seed a recent tail window, never the whole file. When
            # seeding mid-file, align forward to the next newline so we never emit
            # a leading partial line.
            start = max(0, st.st_size - INITIAL_TAIL_BYTES)
            if start > 0:
                fh.seek(start)
                start += len(fh.readline())

        fh.seek(start)
        pending = st.st_size - start
        if pending > MAX_BYTES_PER_TICK:
            log(
                f"TRUNCATED tail {path}: {pending} bytes pending, capped at "
                f"{MAX_BYTES_PER_TICK} (remainder deferred to next tick)"
            )
        raw = fh.read(min(pending, MAX_BYTES_PER_TICK))

    last_nl = raw.rfind(b"\n")
    if last_nl < 0 and pending > MAX_BYTES_PER_TICK:
        # WR-01 (16-REVIEW): a single line larger than MAX_BYTES_PER_TICK has NO
        # newline inside the capped window. Parking the offset at `start` (the old
        # behavior when last_nl == -1) would re-read the same bytes every tick
        # FOREVER — a livelock that also blocks every later line in the file. Force
        # progress: advance past the oversized chunk (dropping the pathological
        # line) and log it. The next tick resumes cleanly after the offending line.
        log(
            f"OVERSIZE single line > {MAX_BYTES_PER_TICK} bytes at {path}; "
            f"advancing offset past it (line dropped)"
        )
        complete = b""
        new_offset = start + len(raw)
    else:
        complete = raw[: last_nl + 1] if last_nl >= 0 else b""
        new_offset = start + (last_nl + 1 if last_nl >= 0 else 0)
    lines = prepend + complete.decode("utf-8", errors="replace").splitlines()

    cursors = dict(cursors)
    cursors[source_key] = {
        "path": path,
        "inode": st.st_ino,
        "offset": new_offset,
        "size": st.st_size,
    }
    return lines, cursors


# Persistent marker emitted (instead of a silent []) when a rotation-boundary
# tail cannot be recovered (a .zst archive with no available decompressor).
# It flows into the tick as a real captured line so the read model shows a
# rotation gap rather than falsely reading "no errors" for that window (C4).
ROTATION_GAP_MARKER = "<rotation-gap>"


def _drain_archive(archive, offset):
    """Drain one rotated archive from `offset` to EOF (capped at MAX_BYTES_PER_TICK).

    `.gz` is decompressed via stdlib gzip. A `.zst` archive is decompressed via
    the optional `zstandard` module when importable; when it is not (or the frame
    is unreadable) a ROTATION_GAP_MARKER line is surfaced instead of dropping the
    tail silently (C4). An `offset` past the archive's size (a truncated/replaced
    file) resets to 0 so the whole archive is re-read rather than seeking past EOF
    (C2 reset rule). Returns (lines, gap) where `gap` is True when a marker was
    emitted for an unrecoverable compressed tail.
    """
    try:
        if archive.endswith(".zst"):
            data = _read_zst(archive)
            if data is None:
                log(f"ROTATION gap (compressed .zst tail unreadable): {archive}")
                return [f"{ROTATION_GAP_MARKER} {archive}"], True
            # zstd frames are whole-file; honor the byte offset post-decompression.
            if offset > len(data):
                offset = 0
            raw = data[offset : offset + MAX_BYTES_PER_TICK]
        else:
            opener = gzip.open if archive.endswith(".gz") else open
            with opener(archive, "rb") as fh:
                # A cursor offset beyond this archive means a different/truncated
                # file rotated in under the same name -> re-read from the head.
                try:
                    size = fh.seek(0, os.SEEK_END)
                except OSError:
                    size = None
                if size is not None and offset > size:
                    offset = 0
                fh.seek(offset)
                raw = fh.read(MAX_BYTES_PER_TICK)
    except OSError:
        return [], False
    last_nl = raw.rfind(b"\n")
    complete = raw[: last_nl + 1] if last_nl >= 0 else raw
    return complete.decode("utf-8", errors="replace").splitlines(), False


def _read_zst(archive):
    """Decompress a whole `.zst` archive to bytes via the optional `zstandard`
    module. Returns None when the module is absent or the frame is unreadable —
    the caller surfaces a rotation-gap marker rather than silently dropping."""
    try:
        import zstandard  # optional; not in the per-node venv by default
    except ImportError:
        return None
    try:
        with open(archive, "rb") as fh:
            return zstandard.ZstdDecompressor().stream_reader(fh).read()
    except Exception:  # malformed frame / truncated archive
        return None


def _drain_previous(path, prev):
    """Drain every rotated archive holding unread tail on a rotation, in mtime
    (chronological) order, from the correct per-archive boundary.

    Two rotation shapes are handled:
      * LND stable-name rename-archive (`lnd.log` -> `lnd.log.1[.gz|.zst]`): the
        cursor's file is now a `.N` sibling of the SAME name. Multiple rotations
        between ticks push it to `.2`/`.3` while never-seen full rotations sit in
        between — each newer archive is drained from 0, the cursor's own archive
        from prev.offset (C2).
      * Postgres day-roll (`postgresql-YYYY-MM-DD.log`): yesterday's dated file is
        a SIBLING, not a `.N` archive of today's name; the glob misses it, so the
        explicit `prev["path"]` is drained directly from prev.offset (C1).

    The cursor's archive is identified by inode (stable across rename) or, failing
    that, by the explicit `prev["path"]`; everything at/after its mtime is unread.
    A `.zst` tail that cannot be decompressed surfaces a ROTATION_GAP_MARKER
    instead of a silent [] (C4). Returns the drained lines in chronological order.
    """
    prev = prev or {}
    prev_path = prev.get("path")
    prev_inode = prev.get("inode")
    prev_offset = prev.get("offset", 0)

    # Stable-name `.N` archives of the current name, PLUS the explicit previous
    # dated path (day-roll: it is a sibling, not a `.N` archive of today's name).
    candidates = [p for p in glob.glob(glob.escape(path) + ".*") if os.path.isfile(p)]
    if prev_path and prev_path != path and os.path.isfile(prev_path) and prev_path not in candidates:
        candidates.append(prev_path)
    if not candidates:
        return []

    def _ino(p):
        try:
            return os.stat(p).st_ino
        except OSError:
            return None

    def _mtime(p):
        try:
            return os.path.getmtime(p)
        except OSError:
            return None

    # Anchor mtime = the mtime of the cursor's own archive (matched by inode, or
    # by the explicit prev_path). Only archives at/after it carry unread tail; an
    # older `.gz` we already fully consumed is skipped.
    anchor_mtime = None
    for p in candidates:
        if prev_inode is not None and _ino(p) == prev_inode:
            anchor_mtime = _mtime(p)
            break
    if anchor_mtime is None and prev_path in candidates:
        anchor_mtime = _mtime(prev_path)

    relevant = []
    for p in candidates:
        mt = _mtime(p)
        if mt is None:
            continue
        if anchor_mtime is None or mt >= anchor_mtime:
            relevant.append((mt, p))
    relevant.sort(key=lambda item: item[0])  # oldest first == chronological lines

    lines = []
    for _mt, p in relevant:
        is_cursor_file = (prev_inode is not None and _ino(p) == prev_inode) or p == prev_path
        start = prev_offset if is_cursor_file else 0
        drained, _gap = _drain_archive(p, start)
        lines.extend(drained)
    return lines


def load_cursors():
    """Load the LOCAL cursor map; tolerate a missing/corrupt file (returns {})."""
    try:
        with open(CURSOR_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_cursors(cursors):
    """Persist the cursor map atomically (temp file + os.replace).

    os.replace is atomic on a POSIX same-filesystem swap, so a killed tick can
    never leave a half-written cursor that would skip or re-ingest lines (T-16-01).
    """
    tmp = CURSOR_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cursors, fh)
    os.replace(tmp, CURSOR_FILE)


# ─────────────────────────────────────────────────────────────────────
# Log-line capture (COL-01) - persist-at-the-discard-point helpers.
# _normalize feeds the sha256 signature ONLY (D-02 dedup); _redact scrubs
# secrets from what is actually STORED (T-15-05 / CLAUDE.md logging rule).
# Classification comes from log_patterns_config rows (D-05) - the matched
# row's id is recorded as config_id, the read-time suppression key.
# ─────────────────────────────────────────────────────────────────────
KEEP_N = 2  # exemplars persisted per signature per tick: first-seen + newest (D-08)
MESSAGE_MAX_CHARS = 8000  # stored message truncation (~8KB, T-15-04)
LOG_EVENT_CONTEXT = 5  # +/- context lines captured around a match (D-01)

# Signature normalization (D-02): recurring lines must collapse to ONE signature.
# Tuned against LND ("2026-01-02 03:04:05.123 [ERR] ...") and PG/syslog shapes
# ("Jan 12 03:04:05 host postgres[12345]: FATAL ...") from the France/Japan
# excerpts (RESEARCH A4).
_RE_TS_ISO = re.compile(r"\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\S*")
_RE_TS_SYSLOG = re.compile(r"\b[A-Z][a-z]{2} {1,2}\d{1,2} \d{2}:\d{2}:\d{2}\b")
_RE_LONG_HEX = re.compile(r"\b[0-9a-fA-F]{16,}\b")
_RE_PID_BRACKET = re.compile(r"\[\d+\]")
# IPv4:port collapse (COL-05, Pattern 5): per-peer broken-pipe lines carry a
# distinct `a.b.c.d:port->e.f.g.h:port` pair each; folding every IPv4:port to
# <addr> (BEFORE the generic =<n> numeric strip) collapses them to ONE signature.
_RE_IP_PORT = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}\b")
_RE_EQ_NUM = re.compile(r"=\d+(?:\.\d+)?")

# Redaction (T-15-05): strip secret-looking material BEFORE storage. Applied to
# both message and context_lines. Never log macaroon bytes / keys / passwords.
_RE_SECRET_KV = re.compile(
    r"(?i)\b(password|passwd|secret|macaroon|token|api[_-]?key|privkey|private[_-]?key)"
    r"\s*[=:]\s*\S+"
)
_RE_HEX_BLOB = re.compile(r"\b[0-9a-fA-F]{32,}\b")
_RE_B64_BLOB = re.compile(r"\b[A-Za-z0-9+/_-]{48,}={0,2}\b")


def _normalize(line):
    """Strip timestamps/pids/long-hex/numeric values so recurring lines collapse
    to a single stable signature (D-02). Signature input ONLY - never stored."""
    s = _RE_TS_ISO.sub("<ts>", line)
    s = _RE_TS_SYSLOG.sub("<ts>", s)
    s = _RE_LONG_HEX.sub("<hex>", s)
    s = _RE_PID_BRACKET.sub("[<n>]", s)
    s = _RE_IP_PORT.sub("<addr>", s)  # BEFORE _RE_EQ_NUM so both sides collapse
    s = _RE_EQ_NUM.sub("=<n>", s)
    return s.strip()


def _redact(text):
    """Scrub secrets before persistence: password=/secret=/macaroon= values plus
    macaroon-like long hex / base64 blobs -> <redacted> (T-15-05)."""
    s = _RE_SECRET_KV.sub(lambda m: m.group(1) + "=<redacted>", text)
    s = _RE_HEX_BLOB.sub("<redacted>", s)
    s = _RE_B64_BLOB.sub("<redacted>", s)
    return s


# Compiled-regex cache for log_patterns_config.match_expression. Config rows are
# Python REGEXES (D-05): literal metacharacters MUST be escaped in the seed (e.g.
# the LND \[WRN\]/\[ERR\]/\[CRT\] tags), while alternations use | and .* spans a
# gap. An uncompilable pattern caches to None and is skipped, so a bad config row
# can never crash a tick.
_MATCH_EXPR_CACHE = {}


def _compile_match_expression(expr):
    """Compile a match_expression regex once, cached. Returns a compiled pattern,
    or None when the expression is empty or not a valid regex."""
    if not expr:
        return None
    if expr not in _MATCH_EXPR_CACHE:
        try:
            _MATCH_EXPR_CACHE[expr] = re.compile(expr)
        except re.error:
            _MATCH_EXPR_CACHE[expr] = None
    return _MATCH_EXPR_CACHE[expr]


def _classify(line, service, config):
    """Match a log_patterns_config row by match_expression REGEX search (D-05).
    Returns (classification, config_id). Rows scoped to another service only
    apply as a fallback; no matching row -> ("other", None) - the read layer
    LEFT-JOINs on config_id and still shows unmatched lines. match_expression is
    a Python regex (see _compile_match_expression); an uncompilable row is
    skipped rather than aborting classification."""
    fallback = None
    for row in config or []:
        pattern = _compile_match_expression(row.get("match_expression"))
        if pattern is None or not pattern.search(line):
            continue
        row_service = row.get("service")
        if row_service and service and row_service != service:
            if fallback is None:
                fallback = row
            continue
        return (row.get("classification") or "other", row.get("id"))
    if fallback is not None:
        return (fallback.get("classification") or "other", fallback.get("id"))
    return ("other", None)


# Tier gating (D-05/D-06): the matched log_patterns_config row's `classification`
# value IS the tier — there is NO separate `tier` column (16-04 re-derives
# classification INTO the info/warn/critical taxonomy). info -> count-only (ZERO
# exemplars); warn -> capped KEEP_N (first-seen + newest, D-08); critical ->
# retain MORE exemplars. Any classification OUTSIDE {info,warn,critical} (a
# pre-reseed benign/other/ap11/ap12 row, or an unmatched substring-only hit)
# defaults to the warn-capped path so a tick never crashes on old config values.
KEEP_N_CRITICAL = 10  # critical signatures retain more exemplars than warn (T-16-05)


def _tier_of(classification):
    """The exemplar-emission tier for a matched row's `classification` value.
    Defensive: anything not in {info,warn,critical} falls back to warn-capped."""
    if classification in ("info", "warn", "critical"):
        return classification
    return "warn"


def _level_of(classification):
    """WR-01/WR-03 (16-REVIEW): map the matched row's `classification` to the
    stored service_log_events.level so the UI chip reflects severity. Previously
    every captured event was hardcoded level="error", so a warn line rendered as a
    red error chip. The web read layer's narrowLevel() collapses error/fatal/crit/
    critical -> "error", warn/warning -> "warn", and everything else -> "info", so:
      info     -> "info"  (info-tier lines are suppressed as exemplars anyway)
      warn     -> "warn"
      critical -> "error"
    An unmatched/`other` line is captured only via the error_pattern substring
    trigger, so it keeps "error"."""
    if classification == "info":
        return "info"
    if classification == "warn":
        return "warn"
    return "error"  # critical + other/unmatched -> error chip


def extract_events(text, error_pattern, service, level, config,
                   context=LOG_EVENT_CONTEXT, source_path=None,
                   return_aggregate=False):
    """Iterate the tailed text; capture each line that matches a
    log_patterns_config regex (via _classify) — capture-by-pattern (COL-05), NOT
    the single error_pattern substring. error_pattern is retained ONLY as an
    additional capture trigger feeding the service_health.error_count axis; it is
    never the sole gate. Build event dicts {service_name, level, message
    (redacted, <=8KB), context_lines (redacted, +/-context), signature,
    classification, config_id, source_path, sig_tick_count}.

    Exemplar emission is tier-gated on the matched row's `classification` (D-05):
    info -> ZERO exemplars (count-only), warn -> KEEP_N (first-seen + newest,
    D-08), critical -> KEEP_N_CRITICAL. sig_tick_count always carries the TRUE
    per-tick occurrence count so the log_patterns AGGREGATE survives for ALL
    matched signatures regardless of tier (D-06).

    With return_aggregate=True, returns (exemplars, aggregates) where each
    aggregate is one-per-signature {signature, service_name, classification,
    config_id, message (redacted sample), sig_tick_count} — the D-06 tally
    _upsert_log_patterns writes even when info-tier exemplars are suppressed.
    Otherwise returns the exemplars list (backward-compatible)."""
    if not text:
        return ([], []) if return_aggregate else []
    lines = text.splitlines()
    buckets = {}  # signature -> {exemplars, count, tier, classification, ...}
    order = []
    for i, line in enumerate(lines):
        signature = hashlib.sha256(_normalize(line).encode("utf-8")).hexdigest()
        bucket = buckets.get(signature)
        if bucket is not None:
            classification, config_id = bucket["classification"], bucket["config_id"]
        else:
            classification, config_id = _classify(line, service, config)
            # Capture-by-pattern gate: a config-regex match (config_id set) OR the
            # legacy error_pattern substring (kept for the error_count axis only).
            substring_hit = bool(error_pattern) and error_pattern in line
            if config_id is None and not substring_hit:
                continue
        tier = _tier_of(classification)
        ctx = "\n".join(lines[max(0, i - context): i + context + 1])
        event = {
            "service_name": service,
            # WR-03: stored level is DERIVED from classification (not the constant
            # `level` arg) so warn/critical render with the correct UI chip.
            "level": _level_of(classification),
            "message": _redact(line)[:MESSAGE_MAX_CHARS],
            "context_lines": _redact(ctx),
            "signature": signature,
            "classification": classification,
            "config_id": config_id,
            "source_path": source_path,
        }
        if bucket is None:
            # info tier: no exemplars stored; the sample (redacted) still seeds
            # the aggregate's sample_message.
            exemplars = [] if tier == "info" else [event]
            buckets[signature] = {
                "exemplars": exemplars,
                "count": 1,
                "tier": tier,
                "classification": classification,
                "config_id": config_id,
                "sample": event,
            }
            order.append(signature)
        else:
            bucket["count"] += 1
            if tier != "info":
                cap = KEEP_N_CRITICAL if tier == "critical" else KEEP_N
                ex = bucket["exemplars"]
                if len(ex) < cap:
                    ex.append(event)
                elif cap >= 2:
                    ex[-1] = event  # always keep the NEWEST as the last exemplar
    events = []
    aggregates = []
    for signature in order:
        bucket = buckets[signature]
        count = bucket["count"]
        aggregates.append({
            "signature": signature,
            "service_name": service,
            "classification": bucket["classification"],
            "config_id": bucket["config_id"],
            "message": bucket["sample"]["message"],
            "sig_tick_count": count,
        })
        for event in bucket["exemplars"]:
            event["sig_tick_count"] = count
            events.append(event)
    if return_aggregate:
        return events, aggregates
    return events


def detect_running(inv, now):
    """RUNNING axis dispatched on detection_method. None for native (Task 2)."""
    method = inv.get("detection_method")
    target = inv.get("running_target")
    if method == "pgrep":
        if not target:
            return False
        rc, _, _ = run_argv(["pgrep", "-f", target])
        return rc == 0
    if method == "systemctl":
        if not target:
            return False
        rc, out, _ = run_argv(["systemctl", "is-active", target])
        return rc == 0 and out.strip() == "active"
    if method == "cron-mtime":
        # A cron batch has no long-lived process - "running" == ran on schedule
        # recently (log mtime within its own expected interval). Pitfall 2.
        epoch, _ = _artifact_mtime(inv.get("artifact_path"))
        if epoch is None:
            return False
        interval = inv.get("expected_interval_seconds") or DEFAULT_INTERVAL_SECONDS
        return (now.timestamp() - epoch) <= interval * FRESHNESS_GRACE
    return None  # "native" -> filled by the infra probe in Task 2


# Gap A (A2a): code-side FATAL/[CRT]-class signatures that DOWN a persistent
# (pgrep) proc's FUNCTIONING axis. Detection is code-side (mirrors
# _count_pg_log_signatures) so no live log_patterns_config row is required to
# fix the fleet. Benign [ERR] noise is deliberately NOT here — only genuinely
# fatal markers down a running+fresh proc.
PERSISTENT_CRITICAL_SIGNATURES = (r"\[CRT\]", r"\bFATAL\b", r"\bFTL\b")
_PERSISTENT_CRITICAL_RE = [re.compile(sig) for sig in PERSISTENT_CRITICAL_SIGNATURES]


def _count_persistent_critical(text):
    """RAW per-line count of FATAL/[CRT]-class signatures in tailed persistent-proc
    text (pure; testable offline). A line counts ONCE even if it matches several
    signatures — it is one critical event."""
    hits = 0
    for line in (text or "").splitlines():
        if any(pat.search(line) for pat in _PERSISTENT_CRITICAL_RE):
            hits += 1
    return hits


def grade_log_service(inv, running, now, config=None, cursors=None):
    """FUNCTIONING via log mtime freshness + success/error markers (D-06).
    COL-01: matched error lines are no longer discarded - extract_events turns
    them into service_log_events rows (with config_id) threaded up to the tick
    alongside the existing error_count (which stays for service_health).

    COL-04: the fixed INITIAL_TAIL_BYTES tail is replaced by the 16-02 cursor
    (read_since) so every line since the last tick is captured, not just the last
    64 KB. Returns the updated `cursors` map in the result dict for the caller to
    persist once per tick."""
    cursors = cursors if cursors is not None else {}
    # Resolve globs/dirs (PG day-roll) to a concrete newest file BEFORE mtime.
    resolved = resolve_artifact(inv.get("artifact_path"))
    epoch, mtime = _artifact_mtime(resolved)
    interval = inv.get("expected_interval_seconds") or DEFAULT_INTERVAL_SECONDS
    fresh = False
    error_count = 0
    critical_hits = 0
    last_success_at = None
    detail = None
    log_events = []
    log_aggregates = []
    # A2a: persistent (pgrep) procs get the NEW functioning semantics; batch/log
    # (non-pgrep) services keep the prior error_count/success_pattern rule intact.
    is_persistent = inv.get("detection_method") == "pgrep"
    if epoch is None:
        detail = "artifact missing"
    else:
        fresh = (now.timestamp() - epoch) <= interval * FRESHNESS_GRACE
        # Cursor keyed by the STABLE service name (survives a PG day-roll).
        source_key = inv.get("service_name") or resolved
        lines, cursors = read_since(source_key, resolved, cursors)
        text = "\n".join(lines)
        success = inv.get("success_pattern")
        error = inv.get("error_pattern")
        if success and success in text:
            last_success_at = mtime
        # error_pattern/text.count(error) stays ONLY for the service_health
        # error_count axis; capture is DECOUPLED from it (COL-05) — extract_events
        # runs on every fresh tail so config-regex matches ([WRN]/[CRT]/seeded
        # signatures) are captured even when the row declares no error_pattern.
        if error:
            error_count = text.count(error)
        log_events, log_aggregates = extract_events(
            text,
            error,
            inv.get("service_name"),
            "error",
            config,
            source_path=resolved,
            return_aggregate=True,
        )
        for event in log_events:
            event["node_pubkey"] = inv.get("node_pubkey")
        if is_persistent:
            # A2a: code-side FATAL/[CRT] detector PLUS any config-classified
            # criticals already surfaced in the aggregates. Benign [ERR] noise
            # is deliberately excluded — only these down a running+fresh proc.
            critical_hits = _count_persistent_critical(text)
            critical_hits += sum(
                1 for agg in log_aggregates
                if agg.get("classification") == "critical"
            )
    if is_persistent:
        # A2a: functioning = running AND fresh, downed ONLY by a critical
        # signature. error_count NO LONGER gates functioning for persistent procs
        # (the benign-[ERR] false-RED fix). Log liveness is the success proxy:
        # when fresh, last_success_at defaults to the artifact mtime.
        functioning = bool(running and fresh and critical_hits == 0)
        if fresh and last_success_at is None:
            last_success_at = mtime
    else:
        # BATCH / everything else: UNCHANGED prior rule (Test 5 regression guard).
        functioning = bool(fresh and error_count == 0)
    # A2b: honest `detail` reason on every functioning=false PERSISTENT row.
    # Batch rows keep their existing detail behavior (only "artifact missing").
    if is_persistent and functioning is False:
        if epoch is None:
            detail = "artifact missing"
        elif not fresh:
            minutes = int((now.timestamp() - epoch) // 60)
            detail = f"artifact stale ({minutes}m old)"
        elif critical_hits > 0:
            detail = f"{critical_hits} critical signature(s) in tail"
        elif not running:
            detail = "process not running (pgrep)"
        else:
            detail = f"functioning=false (running={running}, fresh={fresh})"
    return {
        "running": running,
        "functioning": functioning,
        "last_success_at": last_success_at,
        "last_artifact_mtime": mtime,
        "error_count": error_count,
        "detail": detail,
        "log_events": log_events,
        "log_aggregates": log_aggregates,
        "cursors": cursors,
    }


def grade_service(inv, now, config=None, cursors=None):
    """One service_health row. Native infra rows are completed in Task 2."""
    running = detect_running(inv, now)
    base = {
        "service_name": inv.get("service_name"),
        "node_pubkey": inv.get("node_pubkey"),
        "running": running,
        "functioning": None,
        "last_success_at": None,
        "last_artifact_mtime": None,
        "error_count": None,
        "detail": None,
    }
    if inv.get("detection_method") == "native":
        # Infra trio (bitcoind/esplora/postgres) - native probe wired in Task 2.
        base["detail"] = "native probe pending"
        return base
    base.update(grade_log_service(inv, running, now, config, cursors))
    return base


def _degraded_row(inv, detail="collector error"):
    """A single degraded service_health row for a row whose grading raised an
    OSError (C-iso). functioning=False with an honest `detail` so ONE service
    reads as broken instead of the whole host tick silently producing no rows."""
    return {
        "service_name": inv.get("service_name"),
        "node_pubkey": inv.get("node_pubkey"),
        "running": None,
        "functioning": False,
        "last_success_at": None,
        "last_artifact_mtime": None,
        "error_count": None,
        "detail": detail,
    }


def grade_inventory(inventory, now, chain, esplora_tip, pg_ok, config, cursors):
    """Grade every inventory row with PER-SERVICE OSError isolation (C-iso).

    A single uncaught OSError (resolve_artifact/getmtime/read racing logrotate,
    a vanished mount) must degrade exactly ONE service — functioning=False,
    detail='collector error' — never abort the loop and black out the whole
    host's tick (collect_telemetry.py:1848). Native-probed services with a
    resolvable artifact_path are additionally tailed once through the cursor and
    run through extract_events. Returns
    (services, log_events, log_aggregates, cursors, pg_log_text)."""
    services = []
    log_events = []
    log_aggregates = []
    pg_log_text = None
    for inv in inventory:
        try:
            if inv.get("detection_method") == "native":
                services.append(grade_native_service(inv, chain, esplora_tip, pg_ok))
            else:
                svc = grade_service(inv, now, config, cursors)
                log_events.extend(svc.pop("log_events", None) or [])
                log_aggregates.extend(svc.pop("log_aggregates", None) or [])
                cursors = svc.pop("cursors", cursors)
                services.append(svc)
            # Tailing is DECOUPLED from detection_method (COL-05): a native-probed
            # service (postgres/bitcoind) with a resolvable artifact_path is tailed
            # ONCE via the cursor and its lines run through extract_events too.
            if inv.get("detection_method") == "native" and inv.get("artifact_path"):
                resolved = resolve_artifact(inv["artifact_path"])
                source_key = inv.get("service_name") or resolved
                native_lines, cursors = read_since(source_key, resolved, cursors)
                native_text = "\n".join(native_lines)
                n_events, n_aggs = extract_events(
                    native_text, inv.get("error_pattern"), inv.get("service_name"),
                    "error", config, source_path=resolved,
                    return_aggregate=True,
                )
                for event in n_events:
                    event["node_pubkey"] = inv.get("node_pubkey")
                log_events.extend(n_events)
                log_aggregates.extend(n_aggs)
                if pg_log_text is None and "postgres" in (inv.get("service_name") or "").lower():
                    pg_log_text = native_text
        except OSError as exc:
            # Degrade THIS service honestly; the rest of the host tick proceeds.
            log(f"collector error grading {inv.get('service_name')!r}: {exc}")
            services.append(_degraded_row(inv))
    return services, log_events, log_aggregates, cursors, pg_log_text


# ─────────────────────────────────────────────────────────────────────
# Database - inventory read drives the detection map (D-08)
# ─────────────────────────────────────────────────────────────────────
INVENTORY_COLUMNS = (
    "service_name",
    "node_pubkey",
    "detection_method",
    "running_target",
    "artifact_path",
    "success_pattern",
    "error_pattern",
    "expected_interval_seconds",
    "is_expected",
)


def fetch_inventory(conn, host_id):
    """Declared services for this host (parameter-bound; dimensions are RLS-free)."""
    sql = (
        "SELECT service_name, node_pubkey, detection_method, running_target, "
        "artifact_path, success_pattern, error_pattern, expected_interval_seconds, "
        "is_expected FROM service_inventory WHERE host_id = %s"
    )
    with conn.cursor() as cur:
        cur.execute(sql, (host_id,))
        rows = cur.fetchall()
    conn.rollback()  # end the read txn cleanly before the write txn
    inventory = [dict(zip(INVENTORY_COLUMNS, row)) for row in rows]
    # Only grade the declared expected-set (D-08); others read as no-data.
    return [inv for inv in inventory if inv.get("is_expected")]


LOG_PATTERNS_CONFIG_COLUMNS = (
    "id",
    "match_expression",
    "service",
    "level",
    "classification",
    "suppress",
)


def fetch_log_patterns_config(conn):
    """log_patterns_config rows (D-05 dimension; SELECT-only role, RLS-free).
    MUST include the row id - extract_events records it as config_id, the
    per-pattern read-time suppression key (Plan 03 joins on it). Ordered
    longest-match_expression-first (then id) so _classify's first-match-wins loop
    is DETERMINISTIC and 'most specific pattern wins' when two patterns both
    match a line (WR-01) - e.g. 'FATAL: sorry, too many clients already' (ap12)
    beats the shorter 'FATAL' (critical)."""
    sql = (
        "SELECT id, match_expression, service, level, classification, suppress "
        "FROM log_patterns_config "
        "ORDER BY length(match_expression) DESC, id"
    )
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    conn.rollback()  # end the read txn cleanly before the write txn
    return [dict(zip(LOG_PATTERNS_CONFIG_COLUMNS, row)) for row in rows]


# ─────────────────────────────────────────────────────────────────────
# Infra probes (TEL-03 + D-07 FUNCTIONING) - RAW values only (D-14).
# bitcoind RPC target comes from the env file: NEVER assume the loopback
# default RPC port (Pitfall 6) - read BITCOIND_RPCHOST verbatim.
# ─────────────────────────────────────────────────────────────────────
def _bitcoind_rpc(method, params=None):
    """One bitcoind JSON-RPC call; returns the `result` field or None on failure."""
    host = os.environ.get("BITCOIND_RPCHOST")
    if not host:
        return None
    user = os.environ.get("BITCOIND_RPCUSER")
    secret = os.environ.get("BITCOIND_RPCPASS")
    body = json.dumps(
        {"jsonrpc": "1.0", "id": "nm", "method": method, "params": params or []}
    ).encode("utf-8")
    req = urllib.request.Request(
        f"http://{host}/", data=body, headers={"content-type": "text/plain"}
    )
    if user is not None and secret is not None:
        token = base64.b64encode(f"{user}:{secret}".encode("utf-8")).decode("ascii")
        req.add_header("Authorization", f"Basic {token}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8")).get("result")
    except (urllib.error.URLError, ValueError, OSError):
        return None


def probe_chain():
    """RAW bitcoind chain/mempool fields (D-14: no blocks_behind here). None if down."""
    info = _bitcoind_rpc("getblockchaininfo")
    if info is None:
        return None
    net = _bitcoind_rpc("getnetworkinfo") or {}
    mem = _bitcoind_rpc("getmempoolinfo") or {}
    return {
        "blocks": info.get("blocks"),
        "headers": info.get("headers"),
        "verification_progress": info.get("verificationprogress"),
        "ibd": info.get("initialblockdownload"),
        "size_on_disk_bytes": info.get("size_on_disk"),
        "peer_count": net.get("connections"),
        "peers_in": net.get("connections_in"),
        "peers_out": net.get("connections_out"),
        "mempool_tx_count": mem.get("size"),
        "mempool_bytes": mem.get("bytes"),
        "mempool_min_fee": mem.get("mempoolminfee"),
    }


def probe_esplora_tip():
    """esplora tip-height (int) from the env-supplied endpoint; None if unset/down."""
    url = os.environ.get("ESPLORA_TIP_URL")  # honest no-data if unset (OQ-4)
    if not url:
        return None
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            return int(resp.read().decode("utf-8").strip())
    except (urllib.error.URLError, ValueError, OSError):
        return None


def probe_postgres():
    """postgres liveness via `pg_isready` (rc==0). Optional conninfo from env."""
    conninfo = os.environ.get("PG_PROBE_CONNINFO")
    args = ["pg_isready"]
    if conninfo:
        args += ["-d", conninfo]
    rc, _, _ = run_argv(args)
    return rc == 0


# COL-02 PG-log signature substrings (Obsidian AP-12 runbook). Counted per
# LINE from the tailed PG log this tick - RAW counts only; the AP-12a/b
# discriminator + rate band are derived at read time (D-14 / A5).
PG_SIG_TOO_MANY_CLIENTS = "sorry, too many clients already"
PG_SIG_SERIALIZATION = ("could not serialize", "SQLSTATE 40001")
PG_SIG_FATAL = "FATAL"


def _count_pg_log_signatures(text):
    """RAW per-line signature counts from tailed PG-log text (pure; testable).
    A line matching either serialization form counts once."""
    too_many = 0
    serialization = 0
    fatal = 0
    for line in (text or "").splitlines():
        if PG_SIG_TOO_MANY_CLIENTS in line:
            too_many += 1
        if any(sig in line for sig in PG_SIG_SERIALIZATION):
            serialization += 1
        if PG_SIG_FATAL in line:
            fatal += 1
    return {
        "too_many_clients_count": too_many,
        "serialization_40001_count": serialization,
        "fatal_count": fatal,
    }


def probe_pg_health(pg_log_text=None):
    """Structured PG counters (COL-02) via the SAME PG_PROBE_CONNINFO env var
    probe_postgres already uses (A1 - no new secret). Returns one RAW pg_health
    row dict (NO a/b verdict - derived at read, D-14) or None on any failure
    (honest no-data). stats_reset is stored so read-time deltas can clamp at
    counter resets (Pitfall 7). Log-signature counts come from the tailed PG
    log this tick; None when no PG log is declared in the inventory."""
    conninfo = os.environ.get("PG_PROBE_CONNINFO")
    if not conninfo or psycopg2 is None:
        return None
    try:
        pg_conn = psycopg2.connect(conninfo, connect_timeout=10)
    except Exception:  # noqa: BLE001 - any connect failure = honest no-data
        return None
    try:
        with pg_conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            datname = cur.fetchone()[0]
            cur.execute("SHOW max_connections")
            max_connections = int(cur.fetchone()[0])
            cur.execute(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = %s "
                "AND pid <> pg_backend_pid()",
                (datname,),
            )
            active_connections = cur.fetchone()[0]
            cur.execute(
                "SELECT numbackends, xact_commit, xact_rollback, deadlocks, "
                "stats_reset FROM pg_stat_database WHERE datname = %s",
                (datname,),
            )
            stats = cur.fetchone() or (None, None, None, None, None)
            cur.execute(
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE wait_event_type = %s",
                ("Lock",),
            )
            blocked_queries = cur.fetchone()[0]
            cur.execute(
                "SELECT count(*) FROM pg_stat_activity WHERE state = %s "
                "AND now() - query_start > interval '1 second'",
                ("active",),
            )
            slow_query_gt_1s = cur.fetchone()[0]
        pg_conn.rollback()  # read-only probe: end the txn cleanly
    except Exception:  # noqa: BLE001 - degraded stats read = honest no-data
        return None
    finally:
        pg_conn.close()
    row = {
        "datname": datname,
        "max_connections": max_connections,
        "active_connections": active_connections,
        "numbackends": stats[0],
        "xact_commit": stats[1],
        "xact_rollback": stats[2],
        "deadlocks": stats[3],
        "stats_reset": stats[4],
        "blocked_queries": blocked_queries,
        "slow_query_gt_1s": slow_query_gt_1s,
        "too_many_clients_count": None,
        "serialization_40001_count": None,
        "fatal_count": None,
    }
    if pg_log_text is not None:
        row.update(_count_pg_log_signatures(pg_log_text))
    return row


def grade_native_service(inv, chain, esplora_tip, pg_ok):
    """FUNCTIONING for the infra trio (D-07) from native probe results."""
    name = (inv.get("service_name") or "").lower()
    running = None
    detail = None
    if "bitcoind" in name:
        running = chain is not None and chain.get("blocks") is not None
        detail = None if running else "bitcoind rpc unreachable"
    elif "esplora" in name:
        # NO-DATA vs DOWN discrimination (T-16 esplora stale-row cleanup): esplora is
        # typically a CENTRAL service not run on every node. When ESPLORA_TIP_URL is
        # unset the collector cannot probe it locally — that is honest NO-DATA
        # (running=None), NOT a stale DOWN row for a service that does not run here
        # (consistent with the seed's is_expected=false handling). Only when a URL IS
        # configured and the probe fails do we record a genuine DOWN.
        if not os.environ.get("ESPLORA_TIP_URL"):
            running = None
            detail = None  # central esplora, no local probe — read as NO-DATA
        else:
            running = esplora_tip is not None
            detail = None if running else "esplora tip unavailable"
    elif "postgres" in name or name == "pg":
        running = pg_ok
        detail = None if pg_ok else "pg_isready failed"
    else:
        detail = "unknown native service"
    return {
        "service_name": inv.get("service_name"),
        "node_pubkey": inv.get("node_pubkey"),
        "running": running,
        "functioning": running,  # native: responsive == functioning (bands at read time)
        "last_success_at": None,
        "last_artifact_mtime": None,
        "error_count": None,
        "detail": detail,
    }


# ─────────────────────────────────────────────────────────────────────
# One-tick RLS-scoped write (D-04) + 21-day retention prune (D-02).
# SET LOCAL hard-boxes the txn to this host before any INSERT/DELETE so RLS
# (Plan 02) makes cross-host rows physically impossible. Parameter-bound SQL
# ONLY (psycopg2 placeholders) - never f-string/.format on a query.
# ─────────────────────────────────────────────────────────────────────
PRUNE_TABLES = (
    "host_metrics",
    "host_storage",
    "service_health",
    "chain_telemetry",
    # Phase-15 deep facts (COL-02/03): plain 21-day window. service_log_events
    # keeps its classification-TIERED prune; log_patterns is NEVER pruned.
    "host_metrics_ext",
    "host_cpu_core",
    "host_disk_io",
    "host_net_iface",
    "pg_health",
)


def _insert_host_metrics(cur, host_id, now, host):
    cur.execute(
        "INSERT INTO host_metrics (host_id, collected_at, cpu_pct, load_1, load_5, "
        "load_15, mem_total_kb, mem_available_kb, swap_total_kb, swap_free_kb, "
        "uptime_seconds, net_rx_bytes, net_tx_bytes) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            host_id, now, host["cpu_pct"], host["load_1"], host["load_5"],
            host["load_15"], host["mem_total_kb"], host["mem_available_kb"],
            host["swap_total_kb"], host["swap_free_kb"], host["uptime_seconds"],
            host["net_rx_bytes"], host["net_tx_bytes"],
        ),
    )


def _insert_host_storage(cur, host_id, now, storage):
    for mount in storage:
        cur.execute(
            "INSERT INTO host_storage (host_id, collected_at, mount_point, "
            "total_bytes, used_bytes, avail_bytes, inodes_total, inodes_used, "
            "inodes_free) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                host_id, now, mount["mount_point"], mount["total_bytes"],
                mount["used_bytes"], mount["avail_bytes"],
                mount.get("inodes_total"), mount.get("inodes_used"),
                mount.get("inodes_free"),
            ),
        )


def _insert_host_metrics_ext(cur, host_id, now, ext):
    """One host_metrics_ext scalar row (COL-03). Skipped entirely when the
    gatherer returned nothing (honest no-data). Parameter-bound ONLY."""
    if not ext:
        return
    cur.execute(
        "INSERT INTO host_metrics_ext (host_id, collected_at, ctxt, intr, "
        "cached_kb, buffers_kb, dirty_kb, writeback_kb, slab_kb, sreclaimable_kb, "
        "pgfault, pgmajfault, pswpin, pswpout, oom_kill, tcp_retrans_segs, "
        "tcp_out_segs, tcp_in_segs, tcp_active_opens, tcp_attempt_fails, "
        "sockets_total, tcp_estab, tcp_time_wait, fd_allocated, fd_max, "
        "procs_running, procs_blocked, failed_units_count, clock_offset_seconds, "
        "nproc, entropy_avail, btime) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
        "%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            host_id, now, ext.get("ctxt"), ext.get("intr"), ext.get("cached_kb"),
            ext.get("buffers_kb"), ext.get("dirty_kb"), ext.get("writeback_kb"),
            ext.get("slab_kb"), ext.get("sreclaimable_kb"), ext.get("pgfault"),
            ext.get("pgmajfault"), ext.get("pswpin"), ext.get("pswpout"),
            ext.get("oom_kill"), ext.get("tcp_retrans_segs"),
            ext.get("tcp_out_segs"), ext.get("tcp_in_segs"),
            ext.get("tcp_active_opens"), ext.get("tcp_attempt_fails"),
            ext.get("sockets_total"), ext.get("tcp_estab"),
            ext.get("tcp_time_wait"), ext.get("fd_allocated"), ext.get("fd_max"),
            ext.get("procs_running"), ext.get("procs_blocked"),
            ext.get("failed_units_count"), ext.get("clock_offset_seconds"),
            ext.get("nproc"), ext.get("entropy_avail"), ext.get("btime"),
        ),
    )


def _insert_children(cur, host_id, now, cpu_cores, disk_io, net_ifaces):
    """Per-core / per-device / per-iface child-fact rows (COL-03), mirroring
    the _insert_host_storage loop shape. Parameter-bound ONLY (T-15-01)."""
    for core in cpu_cores or []:
        cur.execute(
            "INSERT INTO host_cpu_core (host_id, collected_at, core_index, "
            "user_jiffies, nice_jiffies, system_jiffies, idle_jiffies, "
            "iowait_jiffies, irq_jiffies, softirq_jiffies, steal_jiffies, "
            "guest_jiffies) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                host_id, now, core.get("core_index"), core.get("user_jiffies"),
                core.get("nice_jiffies"), core.get("system_jiffies"),
                core.get("idle_jiffies"), core.get("iowait_jiffies"),
                core.get("irq_jiffies"), core.get("softirq_jiffies"),
                core.get("steal_jiffies"), core.get("guest_jiffies"),
            ),
        )
    for dev in disk_io or []:
        cur.execute(
            "INSERT INTO host_disk_io (host_id, collected_at, device, "
            "reads_completed, sectors_read, writes_completed, sectors_written, "
            "ios_in_progress, ms_doing_io) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                host_id, now, dev.get("device"), dev.get("reads_completed"),
                dev.get("sectors_read"), dev.get("writes_completed"),
                dev.get("sectors_written"), dev.get("ios_in_progress"),
                dev.get("ms_doing_io"),
            ),
        )
    for iface in net_ifaces or []:
        cur.execute(
            "INSERT INTO host_net_iface (host_id, collected_at, iface, "
            "rx_bytes, rx_errs, rx_drop, tx_bytes, tx_errs, tx_drop, tx_colls) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                host_id, now, iface.get("iface"), iface.get("rx_bytes"),
                iface.get("rx_errs"), iface.get("rx_drop"), iface.get("tx_bytes"),
                iface.get("tx_errs"), iface.get("tx_drop"), iface.get("tx_colls"),
            ),
        )


def _insert_pg_health(cur, host_id, now, pg_health):
    """One pg_health RAW counter row (COL-02). NO variant/severity/band column
    (D-14 - the AP-12a/b discriminator is derived at read time). Skipped when
    the probe returned None (honest no-data). Parameter-bound ONLY."""
    if not pg_health:
        return
    cur.execute(
        "INSERT INTO pg_health (host_id, collected_at, datname, max_connections, "
        "active_connections, numbackends, xact_commit, xact_rollback, deadlocks, "
        "too_many_clients_count, serialization_40001_count, fatal_count, "
        "blocked_queries, slow_query_gt_1s, stats_reset) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            host_id, now, pg_health.get("datname"),
            pg_health.get("max_connections"), pg_health.get("active_connections"),
            pg_health.get("numbackends"), pg_health.get("xact_commit"),
            pg_health.get("xact_rollback"), pg_health.get("deadlocks"),
            pg_health.get("too_many_clients_count"),
            pg_health.get("serialization_40001_count"),
            pg_health.get("fatal_count"), pg_health.get("blocked_queries"),
            pg_health.get("slow_query_gt_1s"), pg_health.get("stats_reset"),
        ),
    )


def _insert_service_health(cur, host_id, now, services):
    for svc in services:
        cur.execute(
            "INSERT INTO service_health (host_id, service_name, node_pubkey, "
            "collected_at, running, functioning, last_success_at, "
            "last_artifact_mtime, error_count, detail) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                host_id, svc["service_name"], svc["node_pubkey"], now,
                svc["running"], svc["functioning"], svc["last_success_at"],
                svc["last_artifact_mtime"], svc["error_count"], svc["detail"],
            ),
        )


def _insert_chain(cur, host_id, now, chain):
    chain = chain or {}
    cur.execute(
        "INSERT INTO chain_telemetry (host_id, collected_at, blocks, headers, "
        "verification_progress, ibd, size_on_disk_bytes, peer_count, peers_in, "
        "peers_out, mempool_tx_count, mempool_bytes, mempool_min_fee) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            host_id, now, chain.get("blocks"), chain.get("headers"),
            chain.get("verification_progress"), chain.get("ibd"),
            chain.get("size_on_disk_bytes"), chain.get("peer_count"),
            chain.get("peers_in"), chain.get("peers_out"),
            chain.get("mempool_tx_count"), chain.get("mempool_bytes"),
            chain.get("mempool_min_fee"),
        ),
    )


def _insert_log_events(cur, host_id, now, log_events):
    """Capped service_log_events exemplars (COL-01). config_id is the matched
    log_patterns_config.id (or NULL) - the key Plan 03's reader joins on to
    resolve suppress per PATTERN. Parameter-bound ONLY (T-15-01)."""
    for event in log_events:
        cur.execute(
            "INSERT INTO service_log_events (host_id, service_name, node_pubkey, "
            "collected_at, level, message, context_lines, signature, "
            "classification, config_id, source_path) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                host_id, event.get("service_name"), event.get("node_pubkey"), now,
                event.get("level"), event.get("message"), event.get("context_lines"),
                event["signature"], event.get("classification"),
                event.get("config_id"), event.get("source_path"),
            ),
        )


def _upsert_log_patterns(cur, host_id, now, log_events):
    """D-03 aggregate upsert: one row per (host_id, signature), count_window
    bumped by this tick's TRUE occurrence count (sig_tick_count) - the fact
    survives even when raw exemplars are later evicted. Parameter-bound ONLY."""
    seen = set()
    for event in log_events:
        signature = event["signature"]
        if signature in seen:  # KEEP_N exemplars share one aggregate bump
            continue
        seen.add(signature)
        cur.execute(
            "INSERT INTO log_patterns (host_id, signature, service_name, "
            "first_seen, last_seen, count_window, sample_message, classification) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (host_id, signature) DO UPDATE SET "
            "last_seen = EXCLUDED.last_seen, "
            "count_window = log_patterns.count_window + EXCLUDED.count_window, "
            "classification = EXCLUDED.classification",
            (
                host_id, signature, event.get("service_name"), now, now,
                event.get("sig_tick_count", 1), event.get("message"),
                event.get("classification"),
            ),
        )


# D-08 classification-tiered retention windows for service_log_events exemplars.
# WR-05 (16-REVIEW): keyed on the LIVE post-16-04 taxonomy {info, warn, critical}
# (plus `other` for unmatched lines). The retired benign/ap11/ap12 keys are gone
# (no rows ever carry them). `critical` now has an EXPLICIT bounded window rather
# than being silently absent (which left critical exemplars accumulating forever).
# `info` exemplars are suppressed at capture time (count-only), so its window is a
# defensive backstop only. The log_patterns AGGREGATE is never pruned (kept forever).
LOG_RETENTION_WINDOWS = (
    ("info", "30 days"),      # defensive: info exemplars are normally not stored
    ("other", "90 days"),     # unmatched lines: unknown importance, keep 90d
    ("warn", "90 days"),
    ("critical", "365 days"),  # long but BOUNDED — critical no longer kept forever
)
# High-frequency, low-value classes whose redundant MIDDLE exemplars are evicted
# per signature (first-seen + newest always kept, D-08). Curated warn/critical
# exemplars are retained fully within their window and are NOT middle-evicted.
LOG_MIDDLE_EVICT_CLASSES = ("other",)


def _prune_tiered(cur):
    """RLS-scoped retention sweep (D-02/D-08): plain 21d windows for the vitals
    facts; keep-N exemplars + classification-tiered windows for
    service_log_events; log_patterns is NEVER pruned (aggregate kept forever).
    All table names come from fixed allow-lists, never user input."""
    for table in PRUNE_TABLES:  # fixed allow-list
        cur.execute(
            "DELETE FROM " + table + " WHERE collected_at < now() - interval '21 days'"
        )
    # Tiered time windows: every live classification (info/warn/critical/other) is
    # listed in LOG_RETENTION_WINDOWS and time-pruned on its own window — critical
    # is now bounded (365d), not kept forever (WR-05).
    for classification, window in LOG_RETENTION_WINDOWS:
        cur.execute(
            "DELETE FROM service_log_events "
            "WHERE classification = %s AND collected_at < now() - %s::interval",
            (classification, window),
        )
    # Keep-N exemplar eviction (D-08): for high-frequency benign/other
    # signatures drop redundant MIDDLE exemplars, always keeping the
    # first-seen and the newest row per (host_id, signature). No hard
    # per-tick ceiling - distinct signatures are never dropped (D-07).
    cur.execute(
        "DELETE FROM service_log_events WHERE id IN ("
        "SELECT id FROM ("
        "SELECT id, classification, "
        "row_number() OVER (PARTITION BY host_id, signature "
        "ORDER BY collected_at ASC, id ASC) AS rn_first, "
        "row_number() OVER (PARTITION BY host_id, signature "
        "ORDER BY collected_at DESC, id DESC) AS rn_last "
        "FROM service_log_events) ranked "
        "WHERE ranked.classification IN %s "
        "AND ranked.rn_first > 1 AND ranked.rn_last > 1)",
        (LOG_MIDDLE_EVICT_CLASSES,),
    )


def _rls_admissible_node_rows(rows, node_pubkey, kind):
    """Drop node-scoped rows the RLS WITH CHECK would reject so they can never
    abort the whole tick and take host-level vitals down with them (CR-02/WR-04).
    The policy predicate is `node_pubkey IS NULL OR node_pubkey = app.node_pubkey`;
    this mirrors it exactly. A transient `lncli getinfo` failure (node_pubkey None)
    or a foreign node's row on a multi-node host is skipped with a warning; the
    host_metrics / host_metrics_ext / pg_health vitals proceed intact."""
    identity = node_pubkey or None
    kept = []
    dropped = 0
    for row in rows or []:
        row_pubkey = row.get("node_pubkey")
        if row_pubkey is None or row_pubkey == identity:
            kept.append(row)
        else:
            dropped += 1
    if dropped:
        log(
            f"skipped {dropped} node-scoped {kind} row(s) not matching "
            f"app.node_pubkey={'set' if identity else 'unset'} — host vitals preserved"
        )
    return kept


def write_tick(conn, host_id, node_pubkey, now, host, host_ext, cpu_cores,
               disk_io, net_ifaces, storage, services, chain, pg_health,
               log_events=None, log_aggregates=None):
    """One transaction: SET LOCAL GUCs, INSERT the tick, prune. Commits on success.
    ALL inserts (incl. the COL-02/03 deep facts + log events + log_patterns
    upsert) MUST stay inside this txn AFTER the SET LOCAL lines - FORCE RLS
    fail-closes them to zero rows otherwise (Pitfall 2).

    log_aggregates carries the D-06 per-signature tally for ALL matched
    signatures (incl. info-tier ones whose exemplars are suppressed); it drives
    the log_patterns upsert so an info flood still bumps the aggregate count.
    Falls back to log_events when no aggregates are supplied (test/back-compat)."""
    log_events = log_events or []
    log_aggregates = log_aggregates if log_aggregates is not None else log_events
    with conn:  # psycopg2 context manager = commit on success / rollback on error
        with conn.cursor() as cur:
            cur.execute("SET LOCAL app.host_id = %s", (host_id,))
            cur.execute("SET LOCAL app.node_pubkey = %s", (node_pubkey or "",))
            # CR-02/WR-04: a node-scoped row the RLS WITH CHECK would reject (an
            # lncli-null identity, or a foreign node's row on a multi-node host)
            # raises inside this txn and rolls back the ENTIRE tick, silently
            # dropping the host's vitals. Filter those rows here so host-level
            # inserts always survive.
            services = _rls_admissible_node_rows(services, node_pubkey, "service_health")
            log_events = _rls_admissible_node_rows(log_events, node_pubkey, "service_log_events")
            _insert_host_metrics(cur, host_id, now, host)
            _insert_host_metrics_ext(cur, host_id, now, host_ext)
            _insert_children(cur, host_id, now, cpu_cores, disk_io, net_ifaces)
            _insert_pg_health(cur, host_id, now, pg_health)
            _insert_host_storage(cur, host_id, now, storage)
            _insert_service_health(cur, host_id, now, services)
            _insert_chain(cur, host_id, now, chain)
            _insert_log_events(cur, host_id, now, log_events)
            # D-06: aggregate bump comes from the per-signature tally (which
            # includes info-tier signatures whose exemplars were suppressed),
            # NOT the emitted exemplars — the count survives the tier gate.
            _upsert_log_patterns(cur, host_id, now, log_aggregates)
            _prune_tiered(cur)


def main():
    env_file = os.environ.get("NODEMON_ENV_FILE", DEFAULT_ENV_FILE)
    if load_dotenv is not None:
        load_dotenv(env_file)

    if psycopg2 is None:
        log("FATAL: psycopg2 not installed; aborting")
        return 1

    host_id = resolve_host_id()
    # Startup self-check (T-16-09 / T-16-11 observability — no warehouse write):
    # fingerprint the build and log the resolved lncli path so a pubkey=none
    # regression is immediately diagnosable in collect-telemetry.log.
    lncli_path = resolved_lncli_path()
    log(f"collector version={COLLECTOR_VERSION} host={host_id} lncli={lncli_path}")
    node_pubkey = resolve_node_pubkey()
    if node_pubkey is None:
        log(
            f"WARN: node_pubkey=none (lncli={lncli_path} `getinfo` returned no "
            "identity_pubkey) — node-scoped service/log rows will be RLS-skipped this "
            "tick; host vitals still land. Check LNCLI points at an absolute wrapper."
        )
    dsn = os.environ.get(DSN_ENV)
    if not dsn:
        log(f"FATAL: {DSN_ENV} not set in the root-only env file; aborting")
        return 1

    now = datetime.now(timezone.utc)
    chain = probe_chain()
    esplora_tip = probe_esplora_tip()
    pg_ok = probe_postgres()

    conn = psycopg2.connect(dsn, connect_timeout=10)
    try:
        inventory = fetch_inventory(conn, host_id)
        patterns_config = fetch_log_patterns_config(conn)
        host = gather_host_metrics()
        host_ext = gather_host_metrics_ext()
        cpu_cores = gather_cpu_cores()
        disk_io = gather_disk_io()
        net_ifaces = gather_net_ifaces()
        storage = gather_host_storage()
        cursors = load_cursors()  # LOCAL node state; persisted after a good tick
        # C-iso: per-service OSError isolation — one bad artifact degrades ONE
        # service (detail='collector error'), never blacks out the host tick.
        # For postgres the captured text is fanned to _count_pg_log_signatures
        # below, so the PG log is never tailed twice.
        services, log_events, log_aggregates, cursors, pg_log_text = grade_inventory(
            inventory, now, chain, esplora_tip, pg_ok, patterns_config, cursors
        )
        pg_health = probe_pg_health(pg_log_text)
        write_tick(
            conn, host_id, node_pubkey, now, host, host_ext, cpu_cores,
            disk_io, net_ifaces, storage, services, chain, pg_health,
            log_events, log_aggregates,
        )
        # Persist cursors only AFTER the warehouse write commits, so a failed tick
        # re-reads (at-least-once) rather than silently skipping unwritten lines.
        save_cursors(cursors)
        log(
            f"wrote tick host={host_id} pubkey={'set' if node_pubkey else 'none'} "
            f"lncli={lncli_path} version={COLLECTOR_VERSION} "
            f"cpu={host['cpu_pct']} cores={len(cpu_cores)} disks={len(disk_io)} "
            f"ifaces={len(net_ifaces)} mounts={len(storage)} "
            f"services={len(services)} log_events={len(log_events)} "
            f"chain={'up' if chain else 'down'} "
            f"pg_health={'up' if pg_health else 'down'}"
        )
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
