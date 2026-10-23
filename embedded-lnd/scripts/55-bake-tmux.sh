#!/bin/bash
# Run the bake detached in a tmux session so it survives a dropped SSH
# connection and can be watched from any machine:
#
#   ./scripts/55-bake-tmux.sh
#   ssh tester-98 -t tmux attach -t lnd-bake      # Ctrl-b d to detach
#
# The pane keeps an interactive shell after the build exits, so the tail of the
# output stays on screen instead of the session disappearing.
. "$(dirname "$0")/env.sh"

SESSION="${SESSION:-lnd-bake}"
LOG="$YOCTO_ROOT/bake-$(date +%Y%m%d-%H%M%S).log"

if tmux has-session -t "$SESSION" 2>/dev/null; then
    # A pane is busy if its shell has any child process. The loop must not run
    # in a pipeline: that puts it in a subshell where the exit status is lost.
    busy=0
    for pane_pid in $(tmux list-panes -t "$SESSION" -F '#{pane_pid}'); do
        pgrep -P "$pane_pid" >/dev/null 2>&1 && busy=1
    done
    if [ "$busy" = 1 ]; then
        echo "Session '$SESSION' is busy. Attach with: tmux attach -t $SESSION" >&2
        exit 1
    fi
    say "Reusing idle session $SESSION"
else
    say "Creating tmux session $SESSION"
    tmux new-session -d -s "$SESSION" -x 200 -y 50
fi

tmux send-keys -t "$SESSION" \
    "cd '$REPO_ROOT' && ./scripts/50-bake.sh 2>&1 | tee '$LOG'" C-m

say "Bake started in tmux session '$SESSION'"
say "Attach:  ssh tester-98 -t tmux attach -t $SESSION"
say "Log:     $LOG"
