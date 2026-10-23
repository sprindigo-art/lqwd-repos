package main

import (
	"database/sql"
	"fmt"
	_ "github.com/lib/pq"
	"gopkg.in/yaml.v3"
	"io/ioutil"
	_ "io/ioutil"
	"log"
	"strings"
)

func readConfig() Config {
	//yfile, err := ioutil.ReadFile("config.yaml")
	yfile, err := ioutil.ReadFile("/data/v3/lnd-885/check-node/config.yaml")
	//yfile, err := ioutil.ReadFile("/lnd/check-node/config.yaml")
	CheckError(err)

	var data Config

	err2 := yaml.Unmarshal(yfile, &data)
	CheckError(err2)

	return data
}
func OpenDatabase() (db *sql.DB, err error) {
	config := readConfig()

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable", config.HOST, config.PORT, config.USERNAME, config.PASS, config.DBNAME)
	db, err = sql.Open("postgres", dsn)

	CheckError(err)
	return db, err
}

func CloseDatabase(db *sql.DB) {
	defer db.Close()
}

func CheckError(err error) {
	if err != nil {
		panic(any(err.Error()))
	}
}

//create node info table
func createNodeInfoTable(db *sql.DB) error {

	creationStmt := fmt.Sprintf("CREATE TABLE IF NOT EXISTS lnd_node_info " +
		"(id SERIAL PRIMARY KEY," +
		"pubkey TEXT NOT NULL," +
		"alias TEXT NOT NULL," +
		"active_channels INT DEFAULT 0 NOT NULL," +
		"pending_channels INT DEFAULT 0 NOT NULL," +
		"inactive_channels INT DEFAULT 0 NOT NULL," +
		"num_peers INT NOT NULL," +
		"block_height INT NOT NULL," +
		"synced_to_chain BOOLEAN NOT NULL," +
		"synced_to_graph BOOLEAN NOT NULL," +
		"uris TEXT NOT NULL," +
		"local_channel_balance BIGINT DEFAULT 0 NOT NULL," +
		"remote_channel_balance BIGINT DEFAULT 0 NOT NULL," +
		"total_channel_balance BIGINT DEFAULT 0 NOT NULL," +
		"total_wallet_balance BIGINT DEFAULT 0 NOT NULL," +
		"confirmed_wallet_balance BIGINT DEFAULT 0 NOT NULL," +
		"unconfirmed_wallet_balance BIGINT DEFAULT 0 NOT NULL," +
		"timestamp TIMESTAMP DEFAULT current_timestamp NOT NULL)")

	_, err := db.Exec(creationStmt)
	return err
}

//create channel info table
func createChannelInfoTable(db *sql.DB) error {
	creationStmt := fmt.Sprintf("CREATE TABLE IF NOT EXISTS lnd_node_channel_info" +
		"(id SERIAL PRIMARY KEY," +
		"active BOOLEAN NOT NULL," +
		"local_pubkey TEXT NOT NULL," +
		"remote_pubkey TEXT NOT NULL," +
		"channel_point TEXT NOT NULL," +
		"chan_id BIGINT NOT NULL," +
		"capacity BIGINT NOT NULL," +
		"local_balance BIGINT NOT NULL," +
		"remote_balance BIGINT NOT NULL," +
		"commit_fee BIGINT NOT NULL," +
		"commit_weight BIGINT NOT NULL," +
		"fee_per_kw BIGINT NOT NULL," +
		"total_satoshis_sent BIGINT NOT NULL," +
		"total_satoshis_received BIGINT NOT NULL," +
		"initiator BOOLEAN NOT NULL," +
		"lifetime BIGINT NOT NULL," +
		"uptime BIGINT NOT NULL," +
		"outgoing_fee_base_msat BIGINT NOT NULL DEFAULT 0," +
		"toutgoing_fee_rate_milli_msat BIGINT NOT NULL DEFAULT 0," +
		"incoming_fee_base_msat BIGINT NOT NULL DEFAULT 0," +
		"incoming_fee_rate_milli_msat BIGINT NOT NULL DEFAULT 0," +
		"timestamp TIMESTAMP DEFAULT current_timestamp NOT NULL)")

	_, err := db.Exec(creationStmt)
	return err
}

//create forwarding history table
func createForwardingHistoryTable(db *sql.DB) error {
	creationStmt := fmt.Sprintf("CREATE TABLE IF NOT EXISTS lnd_node_forwards" +
		"(id SERIAL NOT NULL PRIMARY KEY," +
		"chan_id_in BIGINT NOT NULL," +
		"chan_id_out BIGINT NOT NULL," +
		"amt_in BIGINT NOT NULL," +
		"amt_out BIGINT NOT NULL," +
		"fee bigint NOT NULL," +
		"fee_msat BIGINT NOT NULL," +
		"amt_in_msat BIGINT NOT NULL," +
		"amt_out_msat BIGINT NOT NULL," +
		"timestamp_ns BIGINT NOT NULL," +
		"lnd_pubkey varchar NOT NULL," +
		"UNIQUE (chan_id_in, timestamp_ns))")

	_, err := db.Exec(creationStmt)
	return err
}

//create peer list table
func createPeerNodeInfoTable(db *sql.DB) error {

	creationStmt := fmt.Sprintf("CREATE TABLE lnd_node_peer_info" +
		"(id SERIAL PRIMARY KEY NOT NULL," +
		"peer_pubkey text NOT NULL," +
		"address text NOT NULL," +
		"alias text NOT NULL," +
		"flapcount BIGINT NOT NULL DEFAULT 0," +
		"total_capacity BIGINT NOT NULL DEFAULT 0," +
		"num_channels BIGINT NOT NULL DEFAULT 0," +
		"local_pubkey text NOT NULL," +
		"connected_to text NOT NULL," +
		"timestamp timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP)")

	_, err := db.Exec(creationStmt)
	return err
}

//create closed channels table
func createClosedChannelTable(db *sql.DB) error {
	creationStmt := fmt.Sprintf("CREATE TABLE lnd_node_closed_channels" +
		"(id SERIAL PRIMARY KEY NOT NULL," +
		"channel_point TEXT NOT NULL," +
		"chan_id TEXT NOT NULL," +
		"chain_hash TEXT NOT NULL," +
		"closing_tx_hash TEXT NOT NULL," +
		"remote_pubkey TEXT NOT NULL," +
		"capacity BIGINT NOT NULL DEFAULT 0," +
		"close_height BIGINT NOT NULL DEFAULT 0," +
		"settled_balance BIGINT NOT NULL DEFAULT 0," +
		"time_locked_balance TEXT," +
		"close_type TEXT NOT NULL DEFAULT 'UNKNOWN'," +
		"open_initiator TEXT NOT NULL DEFAULT 'INITIATOR_UNKNOWN'," +
		"close_initiator TEXT NOT NULL DEFAULT 'INITIATOR_UNKNOWN'," +
		"local_pubkey TEXT NOT NULL," +
		"lnd_alias TEXT NOT NULL," +
		"timestamp timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP)")

	_, err := db.Exec(creationStmt)
	return err
}

//create pending channel table
func createPendingChannelTable(db *sql.DB) error {
	creationStmt := fmt.Sprintf("CREATE TABLE lnd_node_pending_channels" +
		"(id SERIAL PRIMARY KEY NOT NULL," +
		"channel_point TEXT NOT NULL," +
		"remote_node_pub TEXT NOT NULL," +
		"capacity BIGINT NOT NULL DEFAULT 0," +
		"local_balance BIGINT NOT NULL DEFAULT 0," +
		"remote_balance BIGINT NOT NULL DEFAULT 0," +
		"local_chan_reserve_sat BIGINT NOT NULL DEFAULT 0," +
		"remote_chan_reserve_sat BIGINT NOT NULL DEFAULT 0," +
		"initiator TEXT NOT NULL DEFAULT 'INITIATOR_UNKNOWN'," +
		"commitment_type TEXT NOT NULL DEFAULT 'UNKNOWN_COMMITMENT_TYPE'," +
		"num_forwarding_packages BIGINT NOT NULL DEFAULT 0," +
		"chan_status_flags TEXT," +
		"private BOOLEAN NOT NULL DEFAULT false," +
		"closing BOOLEAN NOT NULL DEFAULT false," +
		"closing_txid TEXT," +
		"limbo_balance BIGINT NOT NULL DEFAULT 0," +
		"blocks_til_maturity BIGINT NOT NULL DEFAULT 0," +
		"recoverd_balance BIGINT NOT NULL DEFAULT 0," +
		"anchor TEXT," +
		"local_pubkey TEXT NOT NULL," +
		"lnd_alias TEXT NOT NULL," +
		"timestamp timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP)")

	_, err := db.Exec(creationStmt)
	return err
}

//create transaction info table
func createOnChainTransactionTable(db *sql.DB) error {
	creationStmt := fmt.Sprintf("CREATE TABLE lnd_node_transaction_info(" +
		"id integer NOT NULL SERIAL," +
		"tx_hash text NOT NULL," +
		"amount bigint NOT NULL DEFAULT 0," +
		"num_confirmation integer NOT NULL DEFAULT 0," +
		"block_hash text NOT NULL," +
		"block_height bigint NOT NULL DEFAULT 0," +
		"total_fees bigint NOT NULL DEFAULT 0," +
		"address text NOT NULL," +
		"raw_tx_hex text," +
		"label text," +
		"lnd_pubkey text NOT NULL," +
		"lnd_alias text NOT NULL," +
		"timestamp timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP;")

	_, err := db.Exec(creationStmt)
	return err
}

//get last updated on-chain transaction by height and nodename
func getLastUpdatedTransaction(db *sql.DB, lndNode string) (int64, error) {
	selectLastUpdatedStmt := fmt.Sprintf("SELECT t1.block_height "+
		"FROM (SELECT id, lnd_alias, block_height FROM public.lnd_node_transaction_info "+
		"ORDER BY id DESC LIMIT 10000) as t1 WHERE t1.lnd_alias = '%s' ORDER BY t1.id DESC LIMIT 1", lndNode)

	var blockHeight int64
	// Query for a value based on a single row.
	if err := db.QueryRow(selectLastUpdatedStmt).Scan(&blockHeight); err != nil {
		if err == sql.ErrNoRows {
			log.Printf("No Rows in On-Chain Transaction History for %s", lndNode)
			return blockHeight, nil
		} else {
			log.Printf("Error in Getting Last Updated On-Chain Transaction for %s", lndNode)
			return blockHeight, err
		}
	}
	return blockHeight, nil
}

//get last updated
func getLastUpdatedFwdHistory(db *sql.DB, lndNode string) (int64, error) {

	selectLastUpdatedStmt := fmt.Sprintf("SELECT timestamp_ns FROM lnd_node_forwards WHERE lnd_pubkey = '%s' ORDER BY timestamp_ns DESC LIMIT 1", lndNode)

	var timestamp int64
	// Query for a value based on a single row.
	if err := db.QueryRow(selectLastUpdatedStmt).Scan(&timestamp); err != nil {
		if err == sql.ErrNoRows {
			log.Printf("No Rows in Forwarding History for %s", lndNode)
			return timestamp, nil
		} else {
			log.Printf("Error in Getting Last Updated Fwd History for %s", lndNode)
			return timestamp, err
		}
	}
	return timestamp, nil
}

//insert getinfo data
func insertGetInfoData(db *sql.DB, response NodeInfo) error {

	//insert node info into table
	insertNodeInfoStmt := fmt.Sprintf("INSERT INTO lnd_node_info (pubkey, alias, active_channels, pending_channels, inactive_channels, num_peers, block_height, synced_to_chain, synced_to_graph, uris, local_channel_balance, remote_channel_balance, total_wallet_balance, confirmed_wallet_balance, unconfirmed_wallet_balance) VALUES ('%s', '%s', %d, %d, %d, %d, %d, %t, %t,'%s', %d, %d, %d, %d, %d)",
		response.getInfo.IdentityPubkey, strings.ReplaceAll(response.getInfo.Alias, "'", ""), response.getInfo.NumActiveChannels,
		response.getInfo.NumPendingChannels, response.getInfo.NumInactiveChannels, response.getInfo.NumPeers, response.getInfo.BlockHeight,
		response.getInfo.SyncedToChain, response.getInfo.SyncedToGraph, response.getInfo.Uris,
		response.channelbalance.LocalBalance.Sat, response.channelbalance.RemoteBalance.Sat,
		response.walletBalance.TotalBalance, response.walletBalance.ConfirmedBalance, response.walletBalance.UnconfirmedBalance)

	_, err := db.Exec(insertNodeInfoStmt)
	if err != nil {
		log.Println("Failed to Insert Node Info into Table - ", err)

		return err
	}
	return nil
}

//insert forwarding history data
func insertForwardingHistory(db *sql.DB, response NodeInfo) error {

	if len(response.fwdHistoryInfo.ForwardingEvents) == 0 {
		log.Println("No New or Existing Forwards to Insert for ", strings.ReplaceAll(response.getInfo.Alias, "'", ""))
	} else {
		insertFwdHistoryStmt := fmt.Sprintf("INSERT INTO lnd_node_forwards(chan_id_in, chan_id_out, amt_in, amt_out, fee, fee_msat, amt_in_msat, amt_out_msat, timestamp_ns, lnd_pubkey) VALUES ")
		//insert node info into table
		for _, s := range response.fwdHistoryInfo.ForwardingEvents {
			if s == response.fwdHistoryInfo.ForwardingEvents[len(response.fwdHistoryInfo.ForwardingEvents)-1] {
				insertFwdHistoryStmt = insertFwdHistoryStmt + fmt.Sprintf("(%d, %d, %d, %d, %d, %d, %d, %d, %d, '%s')",
					s.ChanIdIn, s.ChanIdOut, s.AmtIn, s.AmtOut, s.Fee, s.FeeMsat, s.AmtInMsat, s.AmtOutMsat, s.TimestampNs, response.getInfo.IdentityPubkey)
			} else {
				insertFwdHistoryStmt = insertFwdHistoryStmt + fmt.Sprintf("(%d, %d, %d, %d, %d, %d, %d, %d, %d, '%s'),",
					s.ChanIdIn, s.ChanIdOut, s.AmtIn, s.AmtOut, s.Fee, s.FeeMsat, s.AmtInMsat, s.AmtOutMsat, s.TimestampNs, response.getInfo.IdentityPubkey)
			}
		}
		insertFwdHistoryStmt = insertFwdHistoryStmt + " ON CONFLICT ON CONSTRAINT lnd_node_forwards_chan_id_in_timestamp_ns_key DO NOTHING;"

		_, err := db.Exec(insertFwdHistoryStmt)
		if err != nil {
			log.Println("Failed to Insert Forwarding History Data into Table - ", err)
			return err
		}
	}
	return nil
}

//insert channels data plus channels fee policy
func insertChannelInfo(db *sql.DB, response NodeInfo) error {

	//if channels is zero skip
	if len(response.listChanInfo) == 0 {
		log.Println("No New or Existing Channels to Insert for ", strings.ReplaceAll(response.getInfo.Alias, "'", ""))
	} else {
		insertChanInfoStmt := fmt.Sprintf("INSERT INTO lnd_node_channel_info(active, local_pubkey, remote_pubkey, " +
			"channel_point, chan_id, capacity, local_balance, remote_balance, commit_fee, commit_weight, fee_per_kw, " +
			"total_satoshis_sent, total_satoshis_received, initiator, lifetime, uptime, outgoing_fee_base_msat, " +
			"outgoing_fee_rate_milli_msat, incoming_fee_base_msat, incoming_fee_rate_milli_msat) VALUES ")

		//insert node info into table
		for _, s := range response.listChanInfo {
			if s.edge != nil || (s.edge.Node2Policy != nil && s.edge.Node1Policy != nil) {
				if s == (response.listChanInfo)[len(response.listChanInfo)-1] {
					insertChanInfoStmt = insertChanInfoStmt + fmt.Sprintf("(%t, '%s', '%s', '%s', %d, %d, %d, %d, %d, %d, %d, %d, %d, %t, %d, %d, %d, %d, %d, %d);",
						s.channel.Active, response.getInfo.IdentityPubkey, s.channel.RemotePubkey, s.channel.ChannelPoint, s.channel.ChanId,
						s.channel.Capacity, s.channel.LocalBalance, s.channel.RemoteBalance, s.channel.CommitFee, s.channel.CommitWeight,
						s.channel.FeePerKw, s.channel.TotalSatoshisSent, s.channel.TotalSatoshisReceived, s.channel.Initiator, s.channel.Lifetime, s.channel.Uptime,
						s.edge.Node1Policy.FeeBaseMsat, s.edge.Node1Policy.FeeRateMilliMsat, s.edge.Node2Policy.FeeBaseMsat, s.edge.Node2Policy.FeeRateMilliMsat)
				} else {
					insertChanInfoStmt = insertChanInfoStmt + fmt.Sprintf("(%t, '%s', '%s', '%s', %d, %d, %d, %d, %d, %d, %d, %d, %d, %t, %d, %d, %d, %d, %d, %d),",
						s.channel.Active, response.getInfo.IdentityPubkey, s.channel.RemotePubkey, s.channel.ChannelPoint, s.channel.ChanId,
						s.channel.Capacity, s.channel.LocalBalance, s.channel.RemoteBalance, s.channel.CommitFee, s.channel.CommitWeight,
						s.channel.FeePerKw, s.channel.TotalSatoshisSent, s.channel.TotalSatoshisReceived, s.channel.Initiator, s.channel.Lifetime, s.channel.Uptime,
						s.edge.Node1Policy.FeeBaseMsat, s.edge.Node1Policy.FeeRateMilliMsat, s.edge.Node2Policy.FeeBaseMsat, s.edge.Node2Policy.FeeRateMilliMsat)
				}
			} else {
				if s == (response.listChanInfo)[len(response.listChanInfo)-1] {
					insertChanInfoStmt = insertChanInfoStmt + fmt.Sprintf("(%t, '%s', '%s', '%s', %d, %d, %d, %d, %d, %d, %d, %d, %d, %t, %d, %d, %d, %d, %d, %d);",
						s.channel.Active, response.getInfo.IdentityPubkey, s.channel.RemotePubkey, s.channel.ChannelPoint, s.channel.ChanId,
						s.channel.Capacity, s.channel.LocalBalance, s.channel.RemoteBalance, s.channel.CommitFee, s.channel.CommitWeight,
						s.channel.FeePerKw, s.channel.TotalSatoshisSent, s.channel.TotalSatoshisReceived, s.channel.Initiator, s.channel.Lifetime, s.channel.Uptime, 0, 0, 0, 0)
				} else {
					insertChanInfoStmt = insertChanInfoStmt + fmt.Sprintf("(%t, '%s', '%s', '%s', %d, %d, %d, %d, %d, %d, %d, %d, %d, %t, %d, %d, %d, %d, %d, %d),",
						s.channel.Active, response.getInfo.IdentityPubkey, s.channel.RemotePubkey, s.channel.ChannelPoint, s.channel.ChanId,
						s.channel.Capacity, s.channel.LocalBalance, s.channel.RemoteBalance, s.channel.CommitFee, s.channel.CommitWeight,
						s.channel.FeePerKw, s.channel.TotalSatoshisSent, s.channel.TotalSatoshisReceived, s.channel.Initiator, s.channel.Lifetime, s.channel.Uptime, 0, 0, 0, 0)
				}
			}
		}
		_, err := db.Exec(insertChanInfoStmt)
		if err != nil {
			log.Println("Failed to Insert Channel Info Data into Table - ", err)
			return err
		}
	}
	return nil

}

//insert peers info
func insertPeerInfo(db *sql.DB, response NodeInfo) error {

	if len(response.listPeers) == 0 {
		log.Println("No Peers to Insert for ", strings.ReplaceAll(response.getInfo.Alias, "'", ""))
	} else {
		//insert peer node info into table
		insertPeerInfoStmt := fmt.Sprintf("INSERT INTO lnd_node_peer_info(peer_pubkey, address, alias, flapcount, total_capacity, num_channels, local_pubkey, connected_to) VALUES")

		//insert node info into table
		for _, s := range response.listPeers {
			if s.info != nil {
				if s == (response.listPeers)[len(response.listPeers)-1] {
					insertPeerInfoStmt = insertPeerInfoStmt + fmt.Sprintf("('%s','%s', '%s', %d, %d, %d, '%s', '%s');",
						s.peer.PubKey, s.peer.Address, strings.ReplaceAll(s.info.Node.Alias, "'", ""), s.peer.FlapCount, s.info.TotalCapacity, s.info.NumChannels, response.getInfo.IdentityPubkey, strings.Trim(response.getInfo.Alias, "'"))
				} else {
					insertPeerInfoStmt = insertPeerInfoStmt + fmt.Sprintf("('%s','%s', '%s', %d, %d, %d, '%s', '%s'),",
						s.peer.PubKey, s.peer.Address, strings.ReplaceAll(s.info.Node.Alias, "'", ""), s.peer.FlapCount, s.info.TotalCapacity, s.info.NumChannels, response.getInfo.IdentityPubkey, strings.Trim(response.getInfo.Alias, "'"))
				}
			} else {
				if s == (response.listPeers)[len(response.listPeers)-1] {
					insertPeerInfoStmt = insertPeerInfoStmt + fmt.Sprintf("('%s','%s', '%s', %d, %d, %d, '%s', '%s');",
						s.peer.PubKey, s.peer.Address, "None", s.peer.FlapCount, 0, 0, response.getInfo.IdentityPubkey, strings.ReplaceAll(response.getInfo.Alias, "'", ""))
				} else {
					insertPeerInfoStmt = insertPeerInfoStmt + fmt.Sprintf("('%s','%s', '%s', %d, %d, %d, '%s', '%s'),",
						s.peer.PubKey, s.peer.Address, "None", s.peer.FlapCount, 0, 0, response.getInfo.IdentityPubkey, strings.ReplaceAll(response.getInfo.Alias, "'", ""))
				}
			}
		}

		_, err := db.Exec(insertPeerInfoStmt)
		if err != nil {
			log.Println("Failed to Insert Peer List into Table - ", err)
			return err
		}
	}
	return nil
}

//insert closed channels
func insertClosedChannels(db *sql.DB, response NodeInfo) error {

	if len(response.listClosedChannels.Channels) > 0 {

		//insert node info into table
		insertClosedChannelStmt := fmt.Sprintf("INSERT INTO lnd_node_closed_channels(channel_point, chan_id, chain_hash, " +
			"closing_tx_hash, remote_pubkey, capacity, close_height, settled_balance, " +
			"time_locked_balance, close_type, open_initiator, close_initiator, local_pubkey, lnd_alias) VALUES ")

		for _, s := range response.listClosedChannels.Channels {
			if s == (response.listClosedChannels.Channels)[len(response.listClosedChannels.Channels)-1] {
				insertClosedChannelStmt = insertClosedChannelStmt + fmt.Sprintf("('%s', %d, '%s', '%s', '%s', %d, %d, %d, %d, '%s', '%s', '%s', '%s', '%s');",
					s.ChannelPoint, s.ChanId, s.ChainHash, s.ClosingTxHash, s.RemotePubkey, s.Capacity, s.CloseHeight,
					s.SettledBalance, s.TimeLockedBalance, s.GetCloseType().String(), s.OpenInitiator.String(),
					s.CloseInitiator.String(), response.getInfo.IdentityPubkey, response.getInfo.Alias)
			} else {
				insertClosedChannelStmt = insertClosedChannelStmt + fmt.Sprintf("('%s', %d, '%s', '%s', '%s', %d, %d, %d, %d, '%s', '%s', '%s', '%s', '%s'),",
					s.ChannelPoint, s.ChanId, s.ChainHash, s.ClosingTxHash, s.RemotePubkey, s.Capacity, s.CloseHeight,
					s.SettledBalance, s.TimeLockedBalance, s.GetCloseType().String(), s.OpenInitiator.String(),
					s.CloseInitiator.String(), response.getInfo.IdentityPubkey, response.getInfo.Alias)
			}
		}

		_, err := db.Exec(insertClosedChannelStmt)
		if err != nil {
			log.Println("Failed to Insert Closed Channel Info into Table - ", err)

			return err
		}

		return nil
	}
	return nil
}

//insert pending open channels
func insertPendingOpenChannels(db *sql.DB, response NodeInfo) error {
	if len(response.listPendingChannels.PendingOpenChannels) > 0 {
		//insert node info into table
		insertPendingOpenChannelStmt := fmt.Sprintf("INSERT INTO lnd_node_pending_channels(channel_point, remote_node_pub, " +
			"capacity, local_balance, remote_balance, local_chan_reserve_sat, remote_chan_reserve_sat, initiator, " +
			"commitment_type, num_forwarding_packages, chan_status_flags, closing, limbo_balance, local_pubkey, lnd_alias) VALUES ")
		for _, s := range response.listPendingChannels.PendingOpenChannels {
			if s == (response.listPendingChannels.PendingOpenChannels)[len(response.listPendingChannels.PendingOpenChannels)-1] {
				insertPendingOpenChannelStmt = insertPendingOpenChannelStmt + fmt.Sprintf("('%s', '%s', %d, %d, %d, %d, %d, '%s', '%s', %d, '%s', %t, %d, '%s', '%s');",
					s.Channel.ChannelPoint, s.Channel.RemoteNodePub, s.Channel.Capacity, s.Channel.LocalBalance, s.Channel.RemoteBalance,
					s.Channel.LocalChanReserveSat, s.Channel.RemoteChanReserveSat, s.Channel.Initiator.String(), s.Channel.CommitmentType.String(),
					s.Channel.NumForwardingPackages, s.Channel.ChanStatusFlags, false, response.listPendingChannels.TotalLimboBalance, response.getInfo.IdentityPubkey, response.getInfo.Alias)
			} else {
				insertPendingOpenChannelStmt = insertPendingOpenChannelStmt + fmt.Sprintf("('%s', '%s', %d, %d, %d, %d, %d, '%s', '%s', %d, '%s', %t, %d, '%s', '%s'),",
					s.Channel.ChannelPoint, s.Channel.RemoteNodePub, s.Channel.Capacity, s.Channel.LocalBalance, s.Channel.RemoteBalance,
					s.Channel.LocalChanReserveSat, s.Channel.RemoteChanReserveSat, s.Channel.Initiator.String(), s.Channel.CommitmentType.String(),
					s.Channel.NumForwardingPackages, s.Channel.ChanStatusFlags, false, response.listPendingChannels.TotalLimboBalance, response.getInfo.IdentityPubkey, response.getInfo.Alias)
			}
		}
		_, err := db.Exec(insertPendingOpenChannelStmt)
		if err != nil {
			log.Println("Failed to Insert Pending Open Channel into Table - ", err)

			return err
		}
		return nil
	}
	return nil
}

//insert pending close channels
func insertPendingCloseChannels(db *sql.DB, response NodeInfo) error {

	if len(response.listPendingChannels.PendingForceClosingChannels) > 0 {

		//insert node info into table
		insertPendingCloseChannelStmt := fmt.Sprintf("INSERT INTO lnd_node_pending_channels(channel_point, remote_node_pub, " +
			"capacity, local_balance, remote_balance, local_chan_reserve_sat, remote_chan_reserve_sat, initiator, " +
			"commitment_type, num_forwarding_packages, chan_status_flags, closing, limbo_balance, local_pubkey, lnd_alias) VALUES ")

		for _, s := range response.listPendingChannels.PendingForceClosingChannels {
			if s == (response.listPendingChannels.PendingForceClosingChannels)[len(response.listPendingChannels.PendingForceClosingChannels)-1] {
				insertPendingCloseChannelStmt = insertPendingCloseChannelStmt + fmt.Sprintf("('%s', '%s', %d, %d, %d, %d, %d, '%s', '%s', %d, '%s', %t, %d, '%s', '%s');",
					s.Channel.ChannelPoint, s.Channel.RemoteNodePub, s.Channel.Capacity, s.Channel.LocalBalance, s.Channel.RemoteBalance,
					s.Channel.LocalChanReserveSat, s.Channel.RemoteChanReserveSat, s.Channel.Initiator.String(), s.Channel.CommitmentType.String(),
					s.Channel.NumForwardingPackages, s.Channel.ChanStatusFlags, true, response.listPendingChannels.TotalLimboBalance, response.getInfo.IdentityPubkey, response.getInfo.Alias)
			} else {
				insertPendingCloseChannelStmt = insertPendingCloseChannelStmt + fmt.Sprintf("('%s', '%s', %d, %d, %d, %d, %d, '%s', '%s', %d, '%s', %t, %d, '%s', '%s'),",
					s.Channel.ChannelPoint, s.Channel.RemoteNodePub, s.Channel.Capacity, s.Channel.LocalBalance, s.Channel.RemoteBalance,
					s.Channel.LocalChanReserveSat, s.Channel.RemoteChanReserveSat, s.Channel.Initiator.String(), s.Channel.CommitmentType.String(),
					s.Channel.NumForwardingPackages, s.Channel.ChanStatusFlags, true, response.listPendingChannels.TotalLimboBalance, response.getInfo.IdentityPubkey, response.getInfo.Alias)
			}
		}
		_, err := db.Exec(insertPendingCloseChannelStmt)
		if err != nil {
			log.Println("Failed to Insert Pending Close Channel into Table - ", err)

			return err
		}
		return nil
	}
	return nil
}

func insertOnChainTransactions(db *sql.DB, response NodeInfo) error {

	if len(response.listTransactions) > 0 {

		//insert on-chain transaction node info into table
		insertTransactionsStmt := fmt.Sprintf("INSERT INTO lnd_node_transaction_info(" +
			"tx_hash, amount, num_confirmation, block_hash, block_height, total_fees, " +
			"address, raw_tx_hex, label, lnd_pubkey, lnd_alias) VALUES ")

		for _, s := range response.listTransactions {
			if s == (response.listTransactions)[len(response.listTransactions)-1] {
				insertTransactionsStmt = insertTransactionsStmt + fmt.Sprintf("('%s', %d, %d, '%s', %d, %d, '%s', '%s', '%s', '%s', '%s');",
					s.TxHash, s.Amount, s.NumConfirmations, s.BlockHash, s.BlockHeight, s.TotalFees, s.DestAddresses, s.RawTxHex, s.Label,
					response.getInfo.IdentityPubkey, response.getInfo.Alias)
			} else {
				insertTransactionsStmt = insertTransactionsStmt + fmt.Sprintf("('%s', %d, %d, '%s', %d, %d, '%s', '%s', '%s', '%s', '%s'),",
					s.TxHash, s.Amount, s.NumConfirmations, s.BlockHash, s.BlockHeight, s.TotalFees, s.DestAddresses, s.RawTxHex, s.Label,
					response.getInfo.IdentityPubkey, response.getInfo.Alias)
			}
		}

		_, err := db.Exec(insertTransactionsStmt)
		if err != nil {
			log.Println("Failed to Insert On-Chain Transactions into Table - ", err)

			return err
		}
		return nil
	} else {
		log.Println("No Transactions Found")
	}

	return nil
}

//insert on-chain transaction
