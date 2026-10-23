package main

import (
	"context"
	"encoding/csv"
	"fmt"
	"google.golang.org/grpc/metadata"
	"log"
	"os"
	"time"

	"github.com/lightningnetwork/lnd/lnrpc/walletrpc"
	"google.golang.org/grpc"
)

var MACAROONOPTION grpc.CallOption

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
	//connect to lightning node
	//lncli := lnrpc.NewLightningClient(grpcConn)
	walletClient := walletrpc.NewWalletKitClient(grpcConn)

	ctx, _ := context.WithTimeout(context.Background(), 30*time.Second)
	ctx = metadata.AppendToOutgoingContext(ctx, "macaroon", macaroon)

	// Set up a gRPC connection to the local LND node.
	conn, err := grpc.Dial("localhost:10009", grpc.WithInsecure())
	if err != nil {
		log.Fatalf("Failed to connect to LND node: %v", err)
	}
	defer conn.Close()

	req := &walletrpc.ListAddressesRequest{}
	resp, err := walletClient.ListAddresses(ctx, req)
	if err != nil {
		log.Fatalf("Failed to retrieve wallet addresses: %v", err)
	}

	// Print the list of wallet addresses.
	//fmt.Println("Wallet addresses:")
	//jsonAddresses := make(map[string]interface{})
	//jsonAddresses["addresses"] = []interface{}{}

	file, err := os.Create("addresses.csv")
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	headers := []string{"address", "balance", "internal"}
	err = writer.Write(headers)
	if err != nil {
		log.Fatal(err)
	}

	for _, addresses := range resp.AccountWithAddresses {
		for _, addr := range addresses.Addresses {
			//addrMap := make(map[string]interface{})
			//addrMap["address"] = addr.GetAddress()
			//addrMap["balance"] = addr.GetBalance()
			//addrMap["internal"] = addr.GetIsInternal()
			//jsonAddresses["addresses"] = append(jsonAddresses["addresses"].([]interface{}), addrMap)
			err = writer.Write([]string{addr.GetAddress(), fmt.Sprintf("%d", addr.GetBalance()), fmt.Sprintf("%t", addr.GetIsInternal())})
			if err != nil {
				log.Fatal(err)
			}
		}
	}

	//jsonData, err := json.MarshalIndent(jsonAddresses, "", "  ")
	//if err != nil {
	//	fmt.Println("Error marshalling JSON:", err)
	//	return
	//}
	//
	//err = ioutil.WriteFile("addresses.json", jsonData, 0644)
	//if err != nil {
	//	fmt.Println(err)
	//	return
	//}

	fmt.Println("Created json file with addresses and balances")
}
