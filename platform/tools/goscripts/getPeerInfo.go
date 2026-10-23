package main

import (
	"context"
	"github.com/lightningnetwork/lnd/lnrpc"
	"log"
)

func getPeerList(lncli lnrpc.LightningClient, ctx context.Context) (*lnrpc.ListPeersResponse, error) {

	listPeersReq := lnrpc.ListPeersRequest{}
	listPeersRes, err := lncli.ListPeers(ctx, &listPeersReq, MACAROONOPTION)

	if err != nil {
		log.Printf("Failed to Get Peers List from LND - Error: %s...\n", err)
		return nil, err
	}

	return listPeersRes, err
}

func getPeerNodeInfo(lncli lnrpc.LightningClient, ctx context.Context, pubkey string) (*lnrpc.NodeInfo, error) {

	nodeInfoReq := lnrpc.NodeInfoRequest{
		PubKey: pubkey,
	}
	nodeInfoRes, err := lncli.GetNodeInfo(ctx, &nodeInfoReq, MACAROONOPTION)

	if err != nil {
		log.Printf("Failed to Get Peer Node Info List from LND - Error: %s...\n", err)
		return nil, err
	}

	return nodeInfoRes, err
}
