package main

import (
	"context"
	"fmt"
	"github.com/lightningnetwork/lnd/lnrpc"
	"github.com/lightningnetwork/lnd/lnrpc/routerrpc"
	"strconv"
)

/*

This `rebalanceChannel` function calculates the target balance for each side of the channel and the amount needed to rebalance the channel.
It then creates a new invoice to receive the rebalancing payment and pays it using the maximum fee specified. If the payment is successful,it prints a success message.
The main function now simply parses the command-line arguments and calls the `rebalanceChannel` function to perform the actual rebalancing.

*/
//to be used if the amt to balance needs to be incoming not outgoing
func getLasHopPubkey(client lnrpc.LightningClient, channelID uint64, localPubkey string) (string, error) {
	// Get the channel info.
	channelInfo, err := client.GetChanInfo(context.Background(), &lnrpc.ChanInfoRequest{ChanId: channelID})
	if err != nil {
		return "", fmt.Errorf("error retrieving channel info: %v", err)
	}

	// Check if the specified peer is one of the channel participants.
	if channelInfo.Node1Pub == localPubkey {
		return channelInfo.Node2Pub, nil
	} else if channelInfo.Node2Pub == localPubkey {
		return channelInfo.Node1Pub, nil
	}

	// If the specified peer is not involved in the channel, return an error.
	return "", fmt.Errorf("specified peer is not involved in the channel")
}

func buildRoute(ctx context.Context, client lnrpc.LightningClient, nodeInfo NodeInfo, chanID uint64, amt uint64, maxFee uint64, balanceIncoming bool) (*lnrpc.Route, error) {

	if balanceIncoming {
		lastHopPubkey, err := getLasHopPubkey(client, chanID, nodeInfo.getInfo.IdentityPubkey)
		if err != nil {
			return nil, err
		}
		// Query the route.
		req := &lnrpc.QueryRoutesRequest{
			PubKey:         nodeInfo.getInfo.IdentityPubkey,
			Amt:            int64(amt),
			FinalCltvDelta: 144,
			FeeLimit: &lnrpc.FeeLimit{
				Limit: &lnrpc.FeeLimit_Fixed{
					Fixed: int64(maxFee),
				},
			},
			LastHopPubkey: []byte(lastHopPubkey),
		}
		//log route request in DB

		resp, err := client.QueryRoutes(ctx, req)
		if err != nil {
			return nil, err
		}

		if len(resp.Routes) == 0 {
			return nil, fmt.Errorf("no routes found")
		}

		// Choose the first route.
		route := resp.Routes[0]

		return &lnrpc.Route{
			Hops: route.Hops,
		}, nil
	} else {
		// Query the route.
		req := &lnrpc.QueryRoutesRequest{
			PubKey:         nodeInfo.getInfo.IdentityPubkey,
			Amt:            int64(amt),
			FinalCltvDelta: 144,
			FeeLimit: &lnrpc.FeeLimit{
				Limit: &lnrpc.FeeLimit_Fixed{
					Fixed: int64(maxFee),
				},
			},
			OutgoingChanId: chanID,
		}
		//log route request in DB

		resp, err := client.QueryRoutes(ctx, req)
		if err != nil {
			return nil, err
		}
		fmt.Println(resp)

		if len(resp.Routes) == 0 {
			return nil, fmt.Errorf("no routes found")
		}

		// Choose the first route.
		route := resp.Routes[0]

		return &lnrpc.Route{
			Hops: route.Hops,
		}, nil
	}

	// Add the incoming and outgoing channels to the route.
	//hops := make([]*lnrpc.Hop, 0, len(route.Hops)+2)
	//
	//hops = append(hops, &lnrpc.Hop{
	//	ChanId: incomingChanID,
	//})

	//hops = append(hops, route.Hops...)

	//
	//hops = append(hops, &lnrpc.Hop{
	//	ChanId: outgoingChanID,
	//})

}

func sendPaymentThroughChannelRoute(ctx context.Context, router routerrpc.RouterClient, invoice string, route *lnrpc.Route) (*lnrpc.HTLCAttempt, error) {

	// Create the payment request.
	req := &routerrpc.SendToRouteRequest{
		PaymentHash: []byte(invoice),
		Route:       route,
	}

	//log req in DB

	resp, err := router.SendToRouteV2(ctx, req)
	if err != nil {
		return nil, err
	}

	// Send the payment request.
	return resp, nil
}

func rebalanceChannel(client lnrpc.LightningClient, router routerrpc.RouterClient, ctx context.Context, nodeInfo NodeInfo, rebalanceChanelInfo RebalanceChannel) error {

	// Create Invoice for specified amount
	//store invoice in DB
	// Create a new invoice to receive the rebalancing payment.

	fmt.Println(rebalanceChanelInfo)
	invoiceReq := &lnrpc.Invoice{
		Value:        rebalanceChanelInfo.AmountToBalance,
		Memo:         "Rebalance channel " + strconv.FormatInt(rebalanceChanelInfo.ChannelID, 10),
		Expiry:       3600,
		FallbackAddr: "",
	}
	invoiceResp, err := client.AddInvoice(ctx, invoiceReq)
	if err != nil {
		return fmt.Errorf("failed to create invoice: %v", err)
	}

	var balanceIncoming bool

	if rebalanceChanelInfo.TargetLocalBalance > rebalanceChanelInfo.Channel.LocalBalance {
		balanceIncoming = false
	} else {
		balanceIncoming = true
	}
	// Build the payment route.
	route, err := buildRoute(ctx, client, nodeInfo, uint64(rebalanceChanelInfo.ChannelID), uint64(rebalanceChanelInfo.AmountToBalance), uint64(rebalanceChanelInfo.MaxFee), balanceIncoming)
	if err != nil {
		return fmt.Errorf("Failed to Build Route: %v", err)
	}

	htlcAttempt, err := sendPaymentThroughChannelRoute(ctx, router, invoiceResp.PaymentRequest, route)
	if err != nil {
		return fmt.Errorf("Failed to Send Payment through Route: %v", err)
	}

	fmt.Println(htlcAttempt)
	//log successful htlc attempt

	//var channel = rebalanceChanelInfo.Channel
	//
	//// Determine which node has more balance in the channel.
	//var localBalance, remoteBalance int64
	//
	//if channel.LocalBalance > channel.RemoteBalance {
	//	localBalance = channel.LocalBalance
	//	remoteBalance = channel.RemoteBalance
	//} else {
	//	localBalance = channel.RemoteBalance
	//	remoteBalance = channel.LocalBalance
	//}
	//
	//var amount int64
	//// Calculate the amount to rebalance.
	//if rebalanceChanelInfo.TargetLocalBalance > channel.LocalBalance {
	//	amount = rebalanceChanelInfo.TargetLocalBalance - channel.LocalBalance
	//} else {
	//	amount = channel.LocalBalance - rebalanceChanelInfo.TargetLocalBalance
	//}
	//
	////amount := targetLocalBalance - channel.LocalBalance
	//
	//if amount <= 0 {
	//	fmt.Println("Channel is already balanced")
	//	return nil
	//}

	//sendPaymentThroughChannelRoute(ctx, client, router, invoiceResp.PaymentRequest, rebalanceChanelInfo.ChannelID)

	return nil
}
