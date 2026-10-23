package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
)

// payRequest is the LUD-06 payRequest response, and the LUD-16 response for a
// lightning address (they are the same document; only how the wallet found the
// URL differs).
type payRequest struct {
	Tag            string `json:"tag"`
	Callback       string `json:"callback"`
	MinSendable    int64  `json:"minSendable"`
	MaxSendable    int64  `json:"maxSendable"`
	Metadata       string `json:"metadata"`
	CommentAllowed int    `json:"commentAllowed,omitempty"`
}

// payResponse is the LUD-06 callback response. The wallet pays pr.
//
// verify is LUD-21: a URL the payer - or our own gateway - can poll to learn
// whether the invoice settled, without holding any credential on this node.
type payResponse struct {
	PR     string        `json:"pr"`
	Routes []interface{} `json:"routes"`
	Verify string        `json:"verify,omitempty"`
}

// verifyResponse is the LUD-21 response.
type verifyResponse struct {
	Status   string `json:"status"`
	Settled  bool   `json:"settled"`
	Preimage string `json:"preimage,omitempty"`
	PR       string `json:"pr"`
}

// errResponse is how LUD-06 reports a failure. Note the HTTP status is 200:
// wallets are told to read "status", and several of them treat a non-2xx
// response as a transport failure and never look at the body.
type errResponse struct {
	Status string `json:"status"`
	Reason string `json:"reason"`
}

// metadata builds the LUD-06 metadata string. It is a JSON *string* whose
// sha256 becomes the invoice's description hash, so it has to be byte-for-byte
// identical between the payRequest and the callback - which is why it is
// generated once and passed around rather than rebuilt per request.
func metadata(name, host, description string) (string, error) {
	entries := [][2]string{
		{"text/plain", description},
	}
	if name != "" && host != "" {
		entries = append(entries, [2]string{
			"text/identifier", name + "@" + host,
		})
	}

	raw, err := json.Marshal(entries)
	if err != nil {
		return "", err
	}

	return string(raw), nil
}

// descriptionHash is the sha256 of the metadata string, which BOLT 11 carries
// as the h tag. A wallet that checks it is checking that the invoice it was
// handed belongs to the payRequest it fetched.
func descriptionHash(meta string) []byte {
	sum := sha256.Sum256([]byte(meta))
	return sum[:]
}

// --- bech32 (BIP-173), as LUD-01 uses it --------------------------------
//
// LNURL is a bech32 string with the hrp "lnurl" and no length limit, so this
// is the plain encoder without BIP-173's 90-character cap. Only encoding is
// needed here: the daemon prints a QR payload, it never parses one.

const bech32Charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

func bech32Polymod(values []byte) uint32 {
	gen := []uint32{0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3}
	chk := uint32(1)
	for _, v := range values {
		top := chk >> 25
		chk = (chk&0x1ffffff)<<5 ^ uint32(v)
		for i := 0; i < 5; i++ {
			if (top>>uint(i))&1 == 1 {
				chk ^= gen[i]
			}
		}
	}
	return chk
}

func bech32HRPExpand(hrp string) []byte {
	out := make([]byte, 0, len(hrp)*2+1)
	for i := 0; i < len(hrp); i++ {
		out = append(out, hrp[i]>>5)
	}
	out = append(out, 0)
	for i := 0; i < len(hrp); i++ {
		out = append(out, hrp[i]&31)
	}
	return out
}

// convertBits regroups a byte slice from 8-bit to 5-bit groups, padding the
// last group. LNURL always encodes whole bytes, so pad is always true here.
func convertBits(data []byte, from, to uint, pad bool) ([]byte, error) {
	var acc, bits uint
	maxv := uint(1<<to) - 1
	out := make([]byte, 0, len(data)*int(from)/int(to)+1)

	for _, b := range data {
		value := uint(b)
		if value>>from != 0 {
			return nil, fmt.Errorf("invalid data range: %d", value)
		}
		acc = acc<<from | value
		bits += from
		for bits >= to {
			bits -= to
			out = append(out, byte(acc>>bits&maxv))
		}
	}

	if pad {
		if bits > 0 {
			out = append(out, byte(acc<<(to-bits)&maxv))
		}
	} else if bits >= from || acc<<(to-bits)&maxv != 0 {
		return nil, fmt.Errorf("invalid padding")
	}

	return out, nil
}

// bech32Encode encodes data under hrp. The result is lowercase; QR encoders
// want it uppercased, which is what encodeLNURL does.
func bech32Encode(hrp string, data []byte) (string, error) {
	converted, err := convertBits(data, 8, 5, true)
	if err != nil {
		return "", err
	}

	values := append(bech32HRPExpand(hrp), converted...)
	polymod := bech32Polymod(append(values, 0, 0, 0, 0, 0, 0)) ^ 1

	var sb strings.Builder
	sb.WriteString(hrp)
	sb.WriteByte('1')
	for _, v := range converted {
		sb.WriteByte(bech32Charset[v])
	}
	for i := 0; i < 6; i++ {
		sb.WriteByte(bech32Charset[polymod>>uint(5*(5-i))&31])
	}

	return sb.String(), nil
}

// encodeLNURL renders a URL as the uppercase LNURL string that goes in a QR
// code. A wallet that cannot do lightning addresses scans this instead.
func encodeLNURL(url string) (string, error) {
	encoded, err := bech32Encode("lnurl", []byte(url))
	if err != nil {
		return "", err
	}

	return strings.ToUpper(encoded), nil
}
