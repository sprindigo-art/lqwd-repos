package main

import (
	"context"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/lightningnetwork/lnd/lnrpc"
	"github.com/linkedin/goavro/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"log"
	"os"
	"strings"
)

var (
	aliceHost        = os.Getenv("ALICE_HOST")
	aliceMacaroonHex = os.Getenv("ALICE_MACAROON")
	aliceLndCert     = os.Getenv("ALICE_CERT")

	bobPubKey      = os.Getenv("BOB_PUBKEY")
	bobHost        = os.Getenv("BOB_HOST")
	bobPeerURL     = os.Getenv("BOB_PEER_URL")
	bobMacaroonHex = os.Getenv("BOB_MACAROON")
	bobLndCert     = os.Getenv("BOB_CERT")
	invoiceAmount int64 = 5
    numOfTransactions = 2

	messageMap = make(map[string]interface{})
	invoiceMap = make(map[string]map[string]interface {})
	paidInvoices = make(map[string]interface{})
)


func createChannel(client lnrpc.LightningClient, ctx context.Context) string {

	listChannelResponse, err := client.ListChannels(ctx, &lnrpc.ListChannelsRequest{
		ActiveOnly: true,
	})

	if err != nil {
		log.Fatalf("list channels error: %v", err)
	}

	for _, channel := range listChannelResponse.Channels {
		if channel.RemotePubkey == bobPubKey {
			return channel.GetChannelPoint()
		}
	}

	//create channel
	destination, _ := hex.DecodeString(bobPubKey)

	channelPoint, err := client.OpenChannelSync(ctx, &lnrpc.OpenChannelRequest{
		NodePubkey:         destination,
		LocalFundingAmount: 500_000,
		TargetConf:         6,
		Private:            true,
	})

	if err != nil {
		log.Fatalf("open channel error: %v", err)
	}

	return channelPoint.String()

}

func peerNodes(client lnrpc.LightningClient, ctx context.Context) string {

	listPeerResponse, err := client.ListPeers(ctx, &lnrpc.ListPeersRequest{})

	if err != nil {
		log.Fatalf("list peers error: %v", err)
	}

	for _, peer := range listPeerResponse.Peers {
		if peer.PubKey == bobPubKey {
			return peer.Address
		}
	}

	peerResponse, err := client.ConnectPeer(ctx, &lnrpc.ConnectPeerRequest{
		Addr: &lnrpc.LightningAddress{
			Pubkey: bobPubKey,
			Host:   bobPeerURL,
		},
	})

	if err != nil {
		log.Fatalf("open channel error: %v", err)
	}

	return peerResponse.String()

}

func bobCreateInvoice(client lnrpc.LightningClient, ctx context.Context) *lnrpc.AddInvoiceResponse {

	resp, err := client.AddInvoice(ctx, &lnrpc.Invoice{
		Value: invoiceAmount,
	})

	if err != nil {
		log.Fatal(err)
	}

	return resp
}

func alicePayInvoice(payRequest interface{}, client lnrpc.LightningClient, ctx context.Context) (payment string) {

	resp, err := client.SendPaymentSync(ctx, &lnrpc.SendRequest{
		PaymentRequest: fmt.Sprintf("%v", payRequest),
	})

	if err != nil {
		log.Fatal(err)
	}

	return resp.String()
}

func createClient(macaroon string, cert string, host string) (lnrpc.LightningClient, context.Context, error) {

	ctx := metadata.AppendToOutgoingContext(context.Background(), "macaroon", macaroon)

	cp := x509.NewCertPool()
	if !cp.AppendCertsFromPEM([]byte(strings.Replace(cert, "\\n", "\n", -1))) {
		log.Fatalf("credentials: failed to append certificates")
	}

	cred := credentials.NewClientTLSFromCert(cp, "")

	conn, err := grpc.Dial(host, grpc.WithTransportCredentials(cred))

	if err != nil {
		return nil, nil, err
	}

	return lnrpc.NewLightningClient(conn), ctx, nil
}

func getAvroCodec() (*goavro.Codec, error) {
	return goavro.NewCodec(`
        {
	"type": "record",
	"name": "LndTransactionMessage",
	"namespace": "com.lqwd.schema",
	"fields": [
	{
		"name": "id",
		"type": "int",
		"doc" : "id of this message"
	},	
	{   
        "name": "reply_id",
        "type": "int",
        "doc" : "id of the request message that this is a reply to" 
    }, 
	{
        "name": "timestamp",
        "type": ["long"],
		"logicalType": "timestamp-millis",
        "doc" : "timestamp of the message composition"
    },
	{
        "name": "username",
        "type": "string",
        "doc" : "username of the user who initiated this action/message"
    },	
	{
		"name": "requested_action",
		"type": ["string"],
		"default": "transaction ",
		"doc":"the action that was requested"
	},
	{
		"name": "description",
		"type": ["null","string"],
		"default" : null,
		"doc" : "description of the message or requested action  (if required)"
	},
	{
        "name": "reply_node_id",
        "type": ["string"],
        "default": "lqwd-lnd",
        "doc": "the id of the LND node that supplied the information"
    },
 
    {   
        "name": "reply_message",
        "type": ["null","string"],
        "default": null,
        "doc" : "reply to the action requested"
    },  
    {   
        "name": "error",
        "type": ["boolean"],
        "default" : false,
        "doc" : "a flag to throw if an error has been encountered"
    },  
    {   
        "name": "error_desc",
        "type": ["null", "string"],
        "default" : null,
        "doc" : "description/ body of an error"
    }   


	]
}`)
}



func main() {

	kafka := InitKafka()

	codec, err := getAvroCodec()

	if err != nil {
		log.Fatalf("An error occurred when getting avro: %v", err)
	}

	for i := 0; i < numOfTransactions; i++{
		runProcess()
	}

	fmt.Printf("running kafka listener trx : %v", paidInvoices)

	for {
		fmt.Println("running kafka listener")

		m, err := kafka.ReadMessage(context.Background())

		if err != nil {
			break
		}


		native, _, err := codec.NativeFromBinary(m.Value[5:])

		if err != nil {
			fmt.Printf("cant convert message from avro : %v", err)
		}

		messageMap := native.(map[string]interface{})

		convertedReplyMes := messageMap["reply_message"].(map[string]interface{})

		err = json.Unmarshal([]byte(convertedReplyMes["string"].(string)), &invoiceMap)

		if err != nil {
			fmt.Printf("unmarshal reply message failed : %v\n", err)
		}

		address := invoiceMap["result"]["r_hash"].(string)
		settled := invoiceMap["result"]["settled"].(bool)


		if settled && paidInvoices[address] == 1{
			fmt.Printf("Monitoring received invoice settled with rHash: %s", address)
			break
		}


	}

	if err := kafka.Close(); err != nil {
		log.Fatal("failed to close reader:", err)
	}

}

func runProcess() {

	aliceClient, aliceCtx, err := createClient(aliceMacaroonHex, aliceLndCert, aliceHost)

	if err != nil {
		log.Fatal("couldn't create client for alice")
	}

	bobClient, bobCtx, err := createClient(bobMacaroonHex, bobLndCert, bobHost)

	if err != nil {
		log.Fatal("couldn't create client for bob")
	}

	peerRes := peerNodes(aliceClient, aliceCtx)

	log.Printf("peer response is : %s", peerRes)

	channelPoint := createChannel(aliceClient, aliceCtx)

	log.Printf("channel response is : %s", channelPoint)

	invoiceRes := bobCreateInvoice(bobClient, bobCtx)

	log.Printf("invoice response is : %s", invoiceRes.String())

	payInvoiceResponse := alicePayInvoice(invoiceRes.PaymentRequest, aliceClient, aliceCtx)

	fmt.Printf("invoice r hash is: %s\n", payInvoiceResponse)

	paidInvoices[base64.StdEncoding.EncodeToString(invoiceRes.RHash)] = 1

	log.Printf("pay invoice response is : %s", payInvoiceResponse)

}
