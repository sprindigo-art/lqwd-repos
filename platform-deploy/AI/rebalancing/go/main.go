package main

import (
	"context"
	"fmt"
	"github.com/avast/retry-go"
	"github.com/cenk/backoff"
	"github.com/lightningnetwork/lnd/lnrpc"
	_ "github.com/lightningnetwork/lnd/lnrpc"
	"github.com/lightningnetwork/lnd/lnrpc/routerrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"log"
	"os"
	"time"
)

type RebalanceChannel struct {
	ID                  int64
	RebalanceID         int64
	LNDNode             string
	ChannelID           int64
	ChannelPoint        string
	AmountToBalance     int64
	TargetRemoteBalance int64
	TargetLocalBalance  int64
	MaxFee              int64
	Balanced            bool
	Channel             ChannelInfo
}

type QueriedRoute struct {
	ID            int64
	RebalanceID   int64
	TotalTimeLock int64
	TotalFees     float64
	TotalAmt      float64
	TotalFeesMsat int64
	TotalAmtMsat  int64
	SuccessProb   float64
}

type QueryHop struct {
	ID               int64
	RouteID          int64
	ChanID           int64
	ChanCapacity     int64
	AmtToForward     int64
	Fee              int64
	Expiry           int64
	AmtToForwardMsat int64
	FeeMsat          int64
	PubKey           string
	TLVPayload       bool
}

type Payment struct {
	ID                 int64
	Error              string
	Preimage           string
	RouteTotalTimeLock int64
	RouteTotalFees     string
	RouteTotalAmt      string
	RouteTotalFeesMsat string
	RouteTotalAmtMsat  string
	Hash               string
	RebalanceID        int64
	QueriedRouteID     int64
}

type PaymentHop struct {
	ID               int64
	PaymentID        int64
	RouteID          int64
	ChanID           int64
	ChanCapacity     int64
	AmtToForward     int64
	Fee              int64
	Expiry           int64
	AmtToForwardMsat int64
	FeeMsat          int64
	PubKey           string
	TLVPayload       bool
}

type Reason struct {
	ID          int64
	Name        string
	Description string
}

type Result struct {
	ID          int64
	Success     bool
	RebalanceID int64
	PaymentID   int64
	ReasonID    int64
}

// Macaroons global var
var MACAROONOPTION grpc.CallOption

type Config struct {
	Routing   RoutingConfig   `yaml:"routing"`
	Rebalance RebalanceConfig `yaml:"rebalance"`
	Nodename  string          `yaml:"nodename"`
	NodePort  int             `yaml:"nodeport"`
}

type RoutingConfig struct {
	Host     string `yaml:"host"`
	Port     string `yaml:"port"`
	DBName   string `yaml:"dbname"`
	Username string `yaml:"username"`
	Password string `yaml:"password"`
}

type RebalanceConfig struct {
	Host     string `yaml:"host"`
	Port     string `yaml:"port"`
	DBName   string `yaml:"dbname"`
	Username string `yaml:"username"`
	Password string `yaml:"password"`
}

type NodeInfo struct {
	getInfo             *lnrpc.GetInfoResponse
	listChannel         *lnrpc.ListChannelsResponse
	walletBalance       *lnrpc.WalletBalanceResponse
	channelbalance      *lnrpc.ChannelBalanceResponse
	fwdHistoryInfo      *lnrpc.ForwardingHistoryResponse
	listChanInfo        []ChanInfo
	listClosedChannels  *lnrpc.ClosedChannelsResponse
	listPendingChannels *lnrpc.PendingChannelsResponse
	listTransactions    []*lnrpc.Transaction
}

type ChannelInfo struct {
	ChanID        int64
	ChannelPoint  string
	LocalBalance  int64
	RemoteBalance int64
	Capacity      int64
}

type ChanInfo struct {
	channel *lnrpc.Channel
	edge    *lnrpc.ChannelEdge
}

/*

Procedure for Channel Balance

1. First get Node Info to use to check tables
2. Get List of Rebalance Info from Rebalance Channel Table specific for Node
	- Information needed:
		- Channel ID/ or Channel Point
		- Amount to Attempt to Balance
		- Max Fee to Use
3. Get List of Channels from Routing DB for Node to compare against previous list
	- Check to see if local or remote balance was the smaller one
	- Determine if it is outgoing or incoming to be set to rebalance
4. Get list of channels which have capacity for amount to balance as Incoming/Outgoing channel to attempt rebalnce for two channels at once
5. Look up Channel information to get Local and Remote Balance
	- Depending on the balance if local is greater or remote is greater will determine channel being starting or end point
6. Using information query available routes using end or start of given channel
	- Begin with amount max as listed in table
	- loop and reduce by 500k Sats while maintaining fee until success probability is above (threshold)
	- if none are found increase fee rate by 10 and loop again with amount reducing from max to min
    - record all queries in DB
7a. If found attempt payment.
7b. If none are found notify something (not sure yet)
8a. Payment Successful - record in DB and mark as balanced
8b. Payment Failure - record reason in DB and return to 3 to retry full process
	- This may cause repeat attempts which is acceptable given potential changes as we recheck channels

*/

func main() {
	file, err := os.OpenFile("rebalance-logs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0777)
	//file, err := os.OpenFile("/data/v3/lnd-885/check-node/logs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0777)
	//file, err := os.OpenFile("/lnd/check-node/logs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0777)
	if err != nil {
		log.Fatal(err)
	}

	log.SetOutput(file)

	var response NodeInfo
	b := backoff.NewExponentialBackOff()
	b.MaxElapsedTime = time.Second * 5

	//create grpc connection and make grpc related calls
	err = retry.Do(
		func() error {
			log.Println("Creating gRPC Connection")
			grpcConn, macaroon, err := grpcSetup()
			if err != nil {
				log.Println("Failed to Create gRPC Connection Retrying...")
				return err
			}
			//create lightning lnrpc client
			lncli := lnrpc.NewLightningClient(grpcConn)

			//create router client
			router := routerrpc.NewRouterClient(grpcConn)

			//create context
			ctx, _ := context.WithTimeout(context.Background(), 30*time.Second)
			ctx = metadata.AppendToOutgoingContext(ctx, "macaroon", macaroon)

			//get node info
			response.getInfo, err = getNodeInfo(lncli, ctx)
			if err != nil {
				log.Println("Failed to Get Node Info")
				return err
			}
			log.Printf("Successfully Received Get Info Response - Alias: %s, Number of Active Channels: %d\n",
				response.getInfo.Alias, response.getInfo.NumActiveChannels)

			//open rebalance db connection
			rebalanceDB, err := OpenRebalanceDatabase()
			if err != nil {
				log.Println("Failed to Connect to Rebalance DB - ", err)
				return err
			}

			//check db is accessible
			err = rebalanceDB.Ping()
			if err != nil {
				log.Println("Failed to Connect to Rebalance DB - ", err)
				return err
			}

			fmt.Println("Connected to Rebalance DB")
			log.Println("Connected to Rebalance DB")

			//open routing db connection
			routingDB, err := OpenRoutingDatabase()
			if err != nil {
				log.Println("Failed to Connect to Routing DB - ", err)
				return err
			}

			//check db is accessible
			err = routingDB.Ping()
			if err != nil {
				log.Println("Failed to Connect to Routing DB - ", err)
				return err
			}
			fmt.Println("Connected to Routing DB")
			log.Println("Connected to Routing DB")

			//database open get rebalance list of channels
			unbalancedChannelList, err := getUnbalancedChannels(rebalanceDB, response.getInfo.Alias)
			if err != nil {
				log.Println("Failed to Get Unbalanced Channel List - ", err)
				return err
			}

			//loop through unbalanced channel list
			for _, channel := range unbalancedChannelList {
				channelInfo, err := GetChannelInfoFromDB(routingDB, channel.ChannelID)
				if err != nil {
					return err
				}

				channel.Channel = *channelInfo
				err = rebalanceChannel(lncli, router, ctx, response, channel)
				if err != nil {
					log.Println("Failed to Rebalance Channel - ", channel.ChannelID, " For ", channel.LNDNode)
				}
			}

			CloseDatabase(rebalanceDB)
			log.Println("Closed Rebalance DB Connection")

			CloseDatabase(routingDB)
			log.Println("Closed Routing DB Connection")
			return nil
		},
		retry.DelayType(func(n uint, err error, config *retry.Config) time.Duration {
			log.Println("Retrying...")
			return retry.BackOffDelay(n, err, config)
		}),
	)
	CheckError(err)

	////connect and insert info into DB
	//err = retry.Do(
	//	func() error {
	//		//open db connection to specified db
	//		database, err := OpenDatabase()
	//		if err != nil {
	//			log.Println("Failed to Connect to DB - ", err)
	//
	//			return err
	//		}
	//
	//		err = database.Ping()
	//		if err != nil {
	//			log.Println("Failed to Connect to DB - ", err)
	//
	//			return err
	//		}
	//
	//		log.Println("Connected to DB")
	//
	//		//check db and create table if none exists
	//		CloseDatabase(database)
	//		return nil
	//	},
	//	retry.DelayType(func(n uint, err error, config *retry.Config) time.Duration {
	//		log.Println("Retrying DB Connection...")
	//		return retry.BackOffDelay(n, err, config)
	//	}),
	//)
	//CheckError(err)
}
