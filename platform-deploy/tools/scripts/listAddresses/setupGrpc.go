package main

import (
	"encoding/hex"
	"fmt"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"gopkg.in/yaml.v3"
	"io/ioutil"
	"log"
	"strings"
)

func CheckError(err error) {
	if err != nil {
		panic(any(err.Error()))
	}
}

func readConfig() Config {
	yfile, err := ioutil.ReadFile("config.yaml")
	//yfile, err := ioutil.ReadFile("/data/v3/lnd-885/check-node/config.yaml")
	//yfile, err := ioutil.ReadFile("/lnd/check-node/config.yaml")
	CheckError(err)

	var data Config

	err2 := yaml.Unmarshal(yfile, &data)
	CheckError(err2)

	return data
}

func grpcSetup() (*grpc.ClientConn, string, error) {

	config := readConfig()
	nodename := config.NODENAME
	nodeport := config.NODEPORT

	lndDir := "/lnd"
	//lndDir := "/data/v3/lnd-885"

	// SSL credentials setup
	var serverName string
	certFileLocation := fmt.Sprintf("%s/tls.cert", lndDir)

	creds, err := credentials.NewClientTLSFromFile(certFileLocation, serverName)
	if err != nil {
		log.Println("Failed to get TLS File: ", err)
		return nil, "", err
	}

	// Macaroon setup
	macaroonFileLocation := fmt.Sprintf("%s/data/chain/bitcoin/mainnet/admin.macaroon", lndDir)

	macaroonString := getMacaroonHex(macaroonFileLocation)

	//macaroonString := "0201036C6E6402F801030A10045441442266B9FEEDC066A4DA77408D1201301A160A0761646472657373120472656164120577726974651A130A04696E666F120472656164120577726974651A170A08696E766F69636573120472656164120577726974651A210A086D616361726F6F6E120867656E6572617465120472656164120577726974651A160A076D657373616765120472656164120577726974651A170A086F6666636861696E120472656164120577726974651A160A076F6E636861696E120472656164120577726974651A140A057065657273120472656164120577726974651A180A067369676E6572120867656E6572617465120472656164000006206CFD83D40FF9413E108959E0898AC5EF439BB98FDD27C92C33DC94D1541B0F20"
	macaroonMap := map[string]string{"macaroon": macaroonString}
	macaroonMetadata := metadata.New(macaroonMap)
	MACAROONOPTION = grpc.Header(&macaroonMetadata)

	grpcServername := fmt.Sprintf("%s:%d", nodename, nodeport)
	conn, err := grpc.Dial(grpcServername, grpc.WithTransportCredentials(creds))
	if err != nil {
		log.Printf("Failed to connect to LND gRPC: %v\n", err)
		return nil, "", err
	}

	return conn, strings.ToUpper(macaroonString), nil
}

func getMacaroonHex(macaroon_file_path string) string {

	macaroonBytes, err := ioutil.ReadFile(macaroon_file_path)

	if err != nil {
		panic(any(err.Error()))
	}

	macaroonString := hex.EncodeToString(macaroonBytes)

	return macaroonString
}
