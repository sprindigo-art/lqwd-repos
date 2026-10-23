package main

import (
	"context"
	"github.com/lightningnetwork/lnd/lnrpc"
	"log"
)

func getChannelInfo(lncli lnrpc.LightningClient, ctx context.Context) (*lnrpc.ListChannelsResponse, error) {

	listChannelReq := lnrpc.ListChannelsRequest{}
	listChannelResp, err := lncli.ListChannels(ctx, &listChannelReq, MACAROONOPTION)

	if err != nil {
		log.Printf("Failed to list channel info from LND - Error: %s...\n", err)
		return nil, err
	}

	return listChannelResp, err
}

func getChannalBalance(lncli lnrpc.LightningClient, ctx context.Context) (*lnrpc.ChannelBalanceResponse, error) {

	channelBalanceReq := lnrpc.ChannelBalanceRequest{}
	channelBalanceResp, err := lncli.ChannelBalance(ctx, &channelBalanceReq, MACAROONOPTION)

	if err != nil {
		log.Printf("Failed to Get Channel Balance from LND - Error: %s...\n", err)
		return nil, err
	}

	return channelBalanceResp, err
}

func getChannelFeePolicy(lncli lnrpc.LightningClient, ctx context.Context, chan_id uint64) (*lnrpc.ChannelEdge, error) {

	channelInfoReq := lnrpc.ChanInfoRequest{
		ChanId: chan_id,
	}
	channelInfoResp, err := lncli.GetChanInfo(ctx, &channelInfoReq, MACAROONOPTION)

	if err != nil {
		log.Printf("Failed to Get Channel Balance from LND - Error: %s...\n", err)
		return nil, err
	}

	return channelInfoResp, err
}

//get pending channels
func getPendingChannels(lncli lnrpc.LightningClient, ctx context.Context) (*lnrpc.PendingChannelsResponse, error) {
	pendingChanReq := lnrpc.PendingChannelsRequest{}
	pendingChanResp, err := lncli.PendingChannels(ctx, &pendingChanReq, MACAROONOPTION)

	if err != nil {
		log.Printf("Failed to Get Pending Channels from LND - Error: %s...\n", err)
		return nil, err
	}

	return pendingChanResp, err
}

//get closed channels
func getClosedChannels(lncli lnrpc.LightningClient, ctx context.Context) (*lnrpc.ClosedChannelsResponse, error) {
	closedChanReq := lnrpc.ClosedChannelsRequest{}
	closedChanResp, err := lncli.ClosedChannels(ctx, &closedChanReq, MACAROONOPTION)

	if err != nil {
		log.Printf("Failed to Get Pending Channels from LND - Error: %s...\n", err)
		return nil, err
	}

	return closedChanResp, err
}
