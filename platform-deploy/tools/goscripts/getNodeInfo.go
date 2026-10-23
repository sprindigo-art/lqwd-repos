package main

import (
	"context"
	"github.com/lightningnetwork/lnd/lnrpc"
	_ "google.golang.org/grpc"
	"log"
	"time"
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

func getWalletBalance(lncli lnrpc.LightningClient, ctx context.Context) (*lnrpc.WalletBalanceResponse, error) {

	walletBalanceReq := lnrpc.WalletBalanceRequest{}
	walletBalanceResp, err := lncli.WalletBalance(ctx, &walletBalanceReq, MACAROONOPTION)

	if err != nil {
		log.Printf("Failed to Get Channel Balance from LND - Error: %s...\n", err)
		return nil, err
	}

	return walletBalanceResp, err
}

func getForwardTxInfo(lncli lnrpc.LightningClient, ctx context.Context, startTimestampNs int64) (*lnrpc.ForwardingHistoryResponse, error) {

	startTime := time.Unix(0, startTimestampNs)

	if startTimestampNs <= 0 {
		currentTime := time.Now()
		startTime = currentTime.AddDate(0, -6, 0)
	}

	fwdHistoryReq := lnrpc.ForwardingHistoryRequest{
		StartTime:    uint64(startTime.Unix()),
		NumMaxEvents: 1000,
	}

	fwdHistoryResp, err := lncli.ForwardingHistory(ctx, &fwdHistoryReq, MACAROONOPTION)

	if err != nil {
		log.Printf("Failed to Get Forwarding History Info from LND - Error: %s...\n", err)
		return nil, err
	}

	return fwdHistoryResp, err
}
