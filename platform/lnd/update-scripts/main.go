package main

import (
	"context"
	"log"
	"time"

	// "github.com/lightningnetwork/lnd/lnrpc"
	"update-scripts/lnrpc"

	_ "github.com/lightningnetwork/lnd/lnrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

// Macaroons global var
var MACAROONOPTION grpc.CallOption

// type NodeInfo struct {
// 	getInfo        *lnrpc.GetInfoResponse
// 	listChannel    *lnrpc.ListChannelsResponse
// 	walletBalance  *lnrpc.WalletBalanceResponse
// 	channelbalance *lnrpc.ChannelBalanceResponse
// 	// fwdHistoryInfo      *lnrpc.ForwardingHistoryResponse
// 	// listPeers    []PeerInfo
// 	// listChanInfo []ChanInfo
// 	// listClosedChannels  *lnrpc.ClosedChannelsResponse
// 	// listPendingChannels *lnrpc.PendingChannelsResponse
// }

// // type ChanInfo struct {
// // 	channel *lnrpc.Channel
// 	edge    *lnrpc.ChannelEdge
// }

// type PeerInfo struct {
// 	peer *lnrpc.Peer
// 	info *lnrpc.NodeInfo
// }

type Config struct {
	USERNAME string `yaml:"username"`
	PASS     string `yaml:"password"`
	HOST     string `yaml:"host"`
	PORT     string `yaml:"port"`
	DBNAME   string `yaml:"dbname"`
	NODEPORT int    `yaml:"nodeport"`
	NODENAME string `yaml:"nodename"`
}

func main() {

	log.Println("Creating gRPC Connection")
	grpcConn, macaroon, err := grpcSetup()
	if err != nil {
		log.Println("Failed to Create gRPC Connection Retrying...")

	}
	lncliw := lnrpc.NewWalletUnlockerClient(grpcConn)

	//connect to lightning node
	// lncli := lnrpc.NewLightningClient(grpcConn)
	ctx, _ := context.WithTimeout(context.Background(), 30*time.Second)
	ctx = metadata.AppendToOutgoingContext(ctx, "macaroon", macaroon)

}

// 	cmd := exec.Command("echo ")
// 	stdin, err := cmd.StdinPipe()
// 	if err != nil {
// 		log.Fatal(err)
// 	}

// 	go func() {
// 		defer stdin.Close()
// 		io.WriteString(stdin, "values written to stdin are passed to cmd's standard input")
// 	}()

// 	out, err := cmd.CombinedOutput()
// 	if err != nil {
// 		log.Fatal(err)
// 	}

// 	fmt.Printf("%s\n", out)
// }

// package main

// import (
// 	"fmt"
// 	"os"
// )

// func main() {

// 	lndNodeName := os.Getenv("LND_PODANME")
// 	// fmt.Println(lndNodeName)
// 	// pid := find_process(lndNodeName)
// 	// fmt.Println(pid)

// access_token := get_access_token()

// fmt.Println(access_token)

// macaroon_string := get_macarron_file("admin.macaroon", lndNodeName)

// save_to_file("addmin.macaroon", macaroon_string)

// stop_result := stop_lnd(lndNodeName)

// fmt.Println(stop_result)

// start_result := start_lnd()

// fmt.Println(start_result)

// status := tail_logs()

// fmt.Println(status)

// unlock_resut := unlock_lnd(lndNodeName)

// fmt.Println(unlock_resut)
// // passphrase := get_passphrase("tlnd-32502-passphrase")
// fmt.Println(passphrase)
// data := get_macarron_file("admin.macaroon", "tlnd-32502")
// save_to_file("admin.macaroon", data)
// s := get_access_token()
// fmt.Println(s)
// main2()
// get_access_token()
// fmt.Println(s)
// pid := find_process("tlnd-32502")
// // read_file()
// // start_lnd()
// // shell_command()
// // db_query()
// fmt.Printf(pid)
// // find := check_process(pid)
// // fmt.Println(pid)
// // fmt.Println(find)
// fmt.Println(get_status())

// size_b := get_file_size()
// fmt.Println(size_b)
// time.Sleep(10 * time.Second)
// size_a := get_file_size()
// fmt.Println(size_a)
// }
