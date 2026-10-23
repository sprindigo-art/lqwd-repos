package main

import (
	"database/sql"
	"fmt"
	_ "github.com/lib/pq"
	"github.com/lightningnetwork/lnd/lnrpc"
	"gopkg.in/yaml.v3"
	_ "io/ioutil"
	"os"
	_ "strings"
)

func readConfig() Config {
	yfile, err := os.ReadFile("config.yaml")
	//yfile, err := ioutil.ReadFile("/data/v3/lnd-885/check-node/config.yaml")
	//yfile, err := ioutil.ReadFile("/lnd/check-node/config.yaml")
	CheckError(err)

	var data Config

	err2 := yaml.Unmarshal(yfile, &data)
	CheckError(err2)

	return data
}

func OpenRebalanceDatabase() (db *sql.DB, err error) {
	config := readConfig().Rebalance

	fmt.Println(config)

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable", config.Host, config.Port, config.Username, config.Password, config.DBName)
	db, err = sql.Open("postgres", dsn)

	fmt.Println(db)
	CheckError(err)
	return db, err
}

func OpenRoutingDatabase() (db *sql.DB, err error) {
	config := readConfig().Routing
	fmt.Println(config)

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable", config.Host, config.Port, config.Username, config.Password, config.DBName)
	db, err = sql.Open("postgres", dsn)
	fmt.Println(db)

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

/*

Create AI tables needed

Tables

1. ai_rebalance_channels
2. ai_queried_routes
3. ai_payments
4. ai_reasons
5. ai_results

*/

// get list of unbalanced channels
func getUnbalancedChannels(db *sql.DB, lndName string) ([]RebalanceChannel, error) {
	rows, err := db.Query("SELECT * FROM ai_rebalance_channels WHERE lnd_node=$1 AND balanced=false", lndName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	channels := make([]RebalanceChannel, 0)

	for rows.Next() {
		var channel RebalanceChannel
		err := rows.Scan(&channel.RebalanceID, &channel.LNDNode, &channel.ChannelID, &channel.ChannelPoint, &channel.AmountToBalance, &channel.MaxFee, &channel.Balanced)
		if err != nil {
			return nil, err
		}

		channels = append(channels, channel)
	}

	return channels, nil
}

func GetChannelInfoFromDB(db *sql.DB, channelId int64) (*ChannelInfo, error) {
	var channelInfo ChannelInfo

	err := db.QueryRow(`
        SELECT channel_id, channel_point, local_balance, remote_balance, capacity
        FROM lnd_node_channel_info
        WHERE channel_id = $1
    `, channelId).Scan(&channelInfo.ChanID, &channelInfo.ChannelPoint, &channelInfo.LocalBalance, &channelInfo.RemoteBalance, &channelInfo.Capacity)

	if err != nil {
		return nil, err
	}

	return &channelInfo, nil
}

func updateBalanceStatus(db *sql.DB, rebalanceID int, balanced bool) error {
	_, err := db.Exec("UPDATE ai_rebalance_channels SET balanced=$1 WHERE rebalance_id=$2", balanced, rebalanceID)
	if err != nil {
		return err
	}

	return nil
}

func insertRebalanceChannel(db *sql.DB, rc *RebalanceChannel) (int64, error) {
	var id int64

	err := db.QueryRow(`
		INSERT INTO ai_rebalance_channels(lnd_node, channel_id, channel_point, amount_to_balance, max_fee, balanced)
		VALUES($1, $2, $3, $4, $5, $6)
		RETURNING rebalance_id;
	`, rc.LNDNode, rc.ChannelID, rc.ChannelPoint, rc.AmountToBalance, rc.MaxFee, rc.Balanced).Scan(&id)

	if err != nil {
		return 0, err
	}

	rc.ID = id

	return id, nil
}

func insertQueriedRoute(conn *sql.DB, rebalanceID int, resp *lnrpc.QueryRoutesResponse) error {

	var routeID int

	queriedRouteQuery := `INSERT INTO ai_queried_routes(
                              rebalance_id,
                              total_time_lock,
                              total_fees_msat,
                              total_amt_msat,
                              success_prob
                              ) VALUES ($1, $2, $3, $4, $5) RETURNING route_id`
	// Insert the queried route into the ai_queried_routes table.
	err := conn.QueryRow(queriedRouteQuery,
		string(rebalanceID),
		resp.Routes[0].TotalTimeLock,
		resp.Routes[0].TotalFeesMsat,
		resp.Routes[0].TotalAmtMsat,
		resp.SuccessProb,
	).Scan(&routeID)

	if err != nil {
		return fmt.Errorf("failed to insert queried route into ai_queried_routes table: %v", err)
	}

	queryRouteHopeStmt := `INSERT INTO ai_query_hop (
                          route_id, 
                          chan_id, 
                          expiry, 
                          amt_to_forward_msat, 
                          fee_msat,
                          pub_key, 
                          tlv_payload
                          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`
	// Insert each hop in the queried route into the ai_query_hop table.
	for i, hop := range resp.Routes[0].Hops {
		_, err := conn.Exec(
			queryRouteHopeStmt,
			string(routeID),
			hop.ChanId,
			hop.Expiry,
			hop.AmtToForwardMsat,
			hop.FeeMsat,
			hop.PubKey,
			hop.TlvPayload,
		)
		if err != nil {
			return fmt.Errorf("failed to insert hop %d into ai_query_hop table: %v", i, err)
		}
	}

	return nil
}

func insertPayment(db *sql.DB, rebalanceID int, queriedRouteID int, payment *lnrpc.Payment) error {
	// Insert payment information into ai_payments table
	paymentQuery := `INSERT INTO ai_payments (
			payment_error,
			payment_preimage,
			total_time_lock,
			total_fees_msat,
			total_amt_msat,
			payment_hash,
			rebalance_id,
			queried_route_id
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8
		) RETURNING payment_id;`

	var paymentID int
	err := db.QueryRow(paymentQuery,
		payment.FailureReason.Descriptor(),
		payment.PaymentPreimage,
		payment.Htlcs[0].Route.TotalTimeLock,
		payment.Htlcs[0].Route.TotalFeesMsat,
		payment.Htlcs[0].Route.TotalAmtMsat,
		payment.PaymentHash,
		rebalanceID,
		queriedRouteID,
	).Scan(&paymentID)

	if err != nil {
		return err
	}

	// Insert payment hop information into ai_payment_hop table
	paymentHopQuery := `INSERT INTO ai_payment_hop (
			payment_id,
			route_id,
			chan_id,
			expiry,
			amt_to_forward_msat,
			fee_msat,
			pub_key,
			tlv_payload
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8
		);`

	for _, hop := range payment.Htlcs[0].Route.Hops {
		_, err = db.Exec(paymentHopQuery,
			paymentID,
			queriedRouteID,
			hop.ChanId,
			hop.Expiry,
			hop.AmtToForwardMsat,
			hop.FeeMsat,
			hop.PubKey,
			hop.TlvPayload,
		)

		if err != nil {
			return err
		}
	}

	return nil
}

func insertResult(db *sql.DB, res Result) error {
	_, err := db.Exec(`
        INSERT INTO ai_results(success, rebalance_id, payment_id, reason_id) VALUES ($1, $2, $3, $4)`,
		res.Success,
		res.RebalanceID,
		res.PaymentID,
		res.ReasonID,
	)

	if err != nil {
		return err
	}

	return nil
}

func getReasonName(db *sql.DB, reasonID int) (string, error) {
	var reasonName string

	err := db.QueryRow("SELECT reason_name FROM ai_reasons WHERE reason_id=$1", reasonID).Scan(&reasonName)
	if err != nil {
		return "", err
	}

	return reasonName, nil
}

func insertReason(db *sql.DB, r Reason) (int64, error) {
	var reasonID int64
	err := db.QueryRow(`
        INSERT INTO ai_reasons(reason_name, reason_description) VALUES ($1, $2) RETURNING reason_id`,
		r.Name,
		r.Description,
	).Scan(&reasonID)

	if err != nil {
		return 0, err
	}

	return reasonID, nil
}
