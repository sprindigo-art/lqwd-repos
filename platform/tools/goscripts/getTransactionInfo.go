package main

import (
	"context"
	"github.com/lightningnetwork/lnd/lnrpc"
	"log"
)

func getTransactionInfo(lncli lnrpc.LightningClient, ctx context.Context, startHeight int64) ([]*lnrpc.Transaction, error) {

	listTxReq := lnrpc.GetTransactionsRequest{
		StartHeight: int32(startHeight) + 1,
	}

	listTxResp, err := lncli.GetTransactions(ctx, &listTxReq, MACAROONOPTION)

	if err != nil {
		log.Printf("Failed to Get On-Chain Transaction Info from LND - Error: %s...\n", err)
		return nil, err
	}

	log.Println(listTxResp)

	if len(listTxResp.Transactions) <= 0 {
		log.Printf("No On-Chain Transactions Found\n")
		return nil, err
	}

	return listTxResp.Transactions, err
}
