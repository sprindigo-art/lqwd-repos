package main

import (
	"context"
	"github.com/lightningnetwork/lnd/lnrpc"
	"log"
)

func getNodeInfo(lncli lnrpc.LightningClient, ctx context.Context) (*lnrpc.GetInfoResponse, error) {

	getInfoRequest := lnrpc.GetInfoRequest{}
	getInfoRes, err := lncli.GetInfo(ctx, &getInfoRequest, MACAROONOPTION)

	if err != nil {
		log.Printf("Failed to Get Info from LND - Error: %s...\n", err)
		return nil, err
	}

	return getInfoRes, err
}

func getChannelListFromNode(lncli lnrpc.LightningClient, ctx context.Context) ([]*lnrpc.Channel, error) {
	getChannelRequest := lnrpc.ListChannelsRequest{}
	getChannelRes, err := lncli.ListChannels(ctx, &getChannelRequest, MACAROONOPTION)

	if err != nil {
		log.Printf("Failed to Get Channel List from LND - Error: %s...\n", err)
		return nil, err
	}

	return getChannelRes.Channels, err
}
