/* eslint-disable */

export function getTransaction(events) {
    let receivedTransactions = []
    let sentTransactions = []

    for (let i = 0; i < events.length; i++) {
        if (events[i].eventType == "SEND") {
            if (sentTransactions.length < 5 && events[i].outgoingAmtMsat != null) {
                sentTransactions.push({
                    amt: events[i].outgoingAmtMsat / 1000,
                    title: events[i].outgoingChannelId,
                    type: 'Invoice',
                });
            }
        } else {
            if (receivedTransactions.length < 3 && events[i].incomingAmtMsat != null) {
                receivedTransactions.push({
                    amt: events[i].incomingAmtMsat / 1000,
                    title: events[i].incomingChannelId,
                    type: 'Invoice',
                });
            }
        }

    }

    return {receivedTransactions, sentTransactions}
}

export function getInvoice(invoices) {
    let hash = {}

    for (let i = 0; i < invoices.length; i++) {
        if(hash[invoices[i].created.split("T")[0]] == null){
            let trx = []
            trx.push({
                amt: invoices[i].value,
                title: invoices[i].paymentAddr,
                type: invoices[i].settled ? "Paid": "Unpaid",
            })
            hash[invoices[i].created.split("T")[0]] = trx
        }else {
            hash[invoices[i].created.split("T")[0]].push({
                amt: invoices[i].value,
                title: invoices[i].paymentAddr,
                type: invoices[i].settled ? "Paid": "Unpaid",
            })
        }
    }

    return hash
}