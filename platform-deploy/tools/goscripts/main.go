package main

import (
	"context"
	"github.com/avast/retry-go"
	"github.com/cenk/backoff"
	"github.com/lightningnetwork/lnd/lnrpc"
	_ "github.com/lightningnetwork/lnd/lnrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"log"
	"os"
	"time"
)

// Macaroons global var
var MACAROONOPTION grpc.CallOption

type NodeInfo struct {
	getInfo             *lnrpc.GetInfoResponse
	listChannel         *lnrpc.ListChannelsResponse
	walletBalance       *lnrpc.WalletBalanceResponse
	channelbalance      *lnrpc.ChannelBalanceResponse
	fwdHistoryInfo      *lnrpc.ForwardingHistoryResponse
	listPeers           []PeerInfo
	listChanInfo        []ChanInfo
	listClosedChannels  *lnrpc.ClosedChannelsResponse
	listPendingChannels *lnrpc.PendingChannelsResponse
	listTransactions    []*lnrpc.Transaction
}

type ChanInfo struct {
	channel *lnrpc.Channel
	edge    *lnrpc.ChannelEdge
}

type PeerInfo struct {
	peer *lnrpc.Peer
	info *lnrpc.NodeInfo
}

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
	//file, err := os.OpenFile("logs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0777)
	file, err := os.OpenFile("/data/v3/lnd-885/check-node/logs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0777)
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
			//connect to lightning node
			lncli := lnrpc.NewLightningClient(grpcConn)
			ctx, _ := context.WithTimeout(context.Background(), 30*time.Second)
			ctx = metadata.AppendToOutgoingContext(ctx, "macaroon", macaroon)

			response.getInfo, err = getNodeInfo(lncli, ctx)
			if err != nil {
				log.Println("Failed to Get Node Info")
				return err
			}
			log.Printf("Successfully Received Get Info Response - Alias: %s, Number of Active Channels: %d, Number of Pending Channels: %d, Number of Inactive Channels: %d\n",
				response.getInfo.Alias, response.getInfo.NumActiveChannels, response.getInfo.NumPendingChannels, response.getInfo.NumInactiveChannels)

			response.channelbalance, err = getChannalBalance(lncli, ctx)
			if err != nil {
				log.Println("Failed to Get Channel Balance")
				return err
			}
			log.Println("Successfully Received Channel Balance - ", response.channelbalance.String())

			response.walletBalance, err = getWalletBalance(lncli, ctx)
			if err != nil {
				log.Println("Failed to Get Wallet Balance")
				return err
			}
			log.Println("Successfully Received Wallet Balance - ", response.walletBalance.String())

			//get channel info and fee info here
			response.listChannel, err = getChannelInfo(lncli, ctx)
			if err != nil {
				log.Println("Failed to Get Channel Info")
				return err
			}
			log.Println("Successfully Got Channel Info")

			chanInfoList := make([]ChanInfo, len(response.listChannel.Channels))
			edge := lnrpc.ChannelEdge{}
			for index, channel := range response.listChannel.Channels {
				chanInfoList[index].channel = channel
				//get fee policy inside loop
				chanInfoList[index].edge = &edge
				chanInfoList[index].edge, err = getChannelFeePolicy(lncli, ctx, chanInfoList[index].channel.ChanId)
				if err != nil {
					chanInfoList[index].edge = &edge
					log.Println("Failed to Get Channel Fee Info for Chan ID - ", channel.ChanId)
				}
			}

			//set chanInfoList
			response.listChanInfo = chanInfoList

			//get peer list info
			tmp_listPeers, err := getPeerList(lncli, ctx)
			if err != nil {
				log.Println("Failed to Get Peer List from LND")
				return err
			}
			log.Println("Successfully Received Peer List from LND")

			//create peer info slice
			peerInfoList := make([]PeerInfo, len(tmp_listPeers.Peers))

			//get detailed peer info from get node info
			for index, peer := range tmp_listPeers.Peers {
				peerInfoList[index].peer = peer
				peerInfoList[index].info, err = getPeerNodeInfo(lncli, ctx, peer.PubKey)
				if err != nil {
					log.Printf("Failed to Get Info for Peer - %s - from LND: %s", peer.PubKey, response.getInfo.Alias)
					peerInfoList[index].info = nil
				} else {
					log.Printf("Successfully Received Info for Peer - %s - from LND: %s", peerInfoList[index].info.Node.Alias, response.getInfo.Alias)
				}
			}

			//set peer info
			response.listPeers = peerInfoList

			//get closed channels
			response.listClosedChannels, err = getClosedChannels(lncli, ctx)
			if err != nil {
				log.Println("Failed to Get Closed Channel List from LND")
				return err
			}
			log.Println("Successfully Received Closed Channel List from LND")

			//get pending channels
			response.listPendingChannels, err = getPendingChannels(lncli, ctx)
			if err != nil {
				log.Println("Failed to Get Pending Channel List from LND")
				return err
			}
			log.Println("Successfully Received Pending Channel List from LND")

			//open db connection to specified db
			database, err := OpenDatabase()
			if err != nil {
				log.Println("Failed to Connect to DB - ", err)
				return err
			}

			err = database.Ping()
			if err != nil {
				log.Println("Failed to Connect to DB - ", err)
				return err
			}

			log.Println("Connected to DB")
			//get last updated time from table to get forwarding history
			timestamp, err := getLastUpdatedFwdHistory(database, response.getInfo.IdentityPubkey)
			if err != nil {
				return err
			}

			blockHeight, err := getLastUpdatedTransaction(database, response.getInfo.Alias)
			if err != nil {
				return err
			}

			//get forwarding history with timestamp
			response.fwdHistoryInfo, err = getForwardTxInfo(lncli, ctx, timestamp)
			if err != nil {
				log.Println("Failed to Get Forwarding History Info")
				return err
			}

			//get transaction info for on-chain transactions
			response.listTransactions, err = getTransactionInfo(lncli, ctx, blockHeight)
			if err != nil {
				log.Println("Failed to Get On-Chain Transaction from LND")
				return err
			}

			log.Println("Successfully Received Forwarding History Info, Total Txs Since Last Check: ", response.fwdHistoryInfo.LastOffsetIndex)
			CloseDatabase(database)
			log.Println("Closed DB Connection")
			return nil
		},
		retry.DelayType(func(n uint, err error, config *retry.Config) time.Duration {
			log.Println("Retrying...")
			return retry.BackOffDelay(n, err, config)
		}),
	)
	CheckError(err)

	//connect and insert info into DB
	err = retry.Do(
		func() error {
			//open db connection to specified db
			database, err := OpenDatabase()
			if err != nil {
				log.Println("Failed to Connect to DB - ", err)

				return err
			}

			err = database.Ping()
			if err != nil {
				log.Println("Failed to Connect to DB - ", err)

				return err
			}

			log.Println("Connected to DB")

			//check db and create table if none exists
			err = createNodeInfoTable(database)
			if err != nil {
				log.Println("Failed to Attempt/Create Node Info Table - ", err)
				return err
			}

			//insert getinfo data
			err = insertGetInfoData(database, response)
			if err != nil {
				return err
			}

			//insert forwarding history data
			err = insertForwardingHistory(database, response)
			if err != nil {
				return err
			}

			//insert peer info
			err = insertPeerInfo(database, response)
			if err != nil {
				return err
			}

			//insert channel and fee related data
			err = insertChannelInfo(database, response)
			if err != nil {
				return err
			}

			//insert pending open channels
			err = insertPendingOpenChannels(database, response)
			if err != nil {
				return err
			}

			//insert pending close channels
			err = insertPendingCloseChannels(database, response)
			if err != nil {
				return err
			}

			//insert close channels
			err = insertClosedChannels(database, response)
			if err != nil {
				return err
			}

			//insert transaction info
			err = insertOnChainTransactions(database, response)
			if err != nil {
				return err
			}

			CloseDatabase(database)
			return nil
		},
		retry.DelayType(func(n uint, err error, config *retry.Config) time.Duration {
			log.Println("Retrying DB Connection...")
			return retry.BackOffDelay(n, err, config)
		}),
	)
	CheckError(err)
}
