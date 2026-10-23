/* eslint-disable */
import { transactions } from '../../components/Transaction/TransactionStorybookExample'
import {
    TRANSACTIONS_APPLY_FILTER,
    TRANSACTIONS_GET_ALL,
    TRANSACTIONS_GET_ALL_FAIL,
    TRANSACTIONS_GET_ALL_SUCCESS,
} from "./TransactionsPageConstants";
import { allTransactionTypes, allTransactionStatus } from '../../components/TransactionFilter/TransactionFilter'
var _ = require('lodash');

export const initialState = {
    transactions: [],
    rawTransactionData: [],
    response: {},
    filteredTransactions: [],
    filter: {
        byString: '',
        byNodeNames: [],
        byTransactionType: [],
        byDates: null,
        bySpentReceived: [],
        byStatus: [],
    },
    loading: false,
    error: false,
    errMsg: '',
    pageNumber: 0,
    totalPages: 0,
};

const invoiceStatusMap = () => {

}

const invoice2transaction = (rawData) => {
    //sort by creation date
    rawData = rawData.sort(function(a, b) { return b.creationDate - a.creationDate });
    let t = [];
    rawData.forEach((item) => {
        let i = {};
        i.Node = item.node;
        i.TransactionID = item.trxId;
        i.Type = item.type.toLowerCase();
        i.Status = item.state.toLowerCase();
        //temporary convert back to epoch
        var someDate = new Date(item.created);
        someDate = someDate.getTime() / 1000;
        i.Time = new Date(Number.parseInt(someDate) * 1000).toLocaleString();
        i.CreationDate = someDate;
        i.Amount = Math.abs(item.amount);
        i.isReceived = (item.amount > 0);
        t.push(i);
    });
    return t;
}

const applyFilter = (alltransactions, filter) => {

    let results = JSON.parse(JSON.stringify(alltransactions));

    if (filter.byString !== '') {
        results = results.filter(obj => {
            return obj.TransactionID.includes(filter.byString);
        });
    }
    if (!_.isEmpty(filter.byNodeNames)) {
        results = results.filter(obj => {
            return filter.byNodeNames.includes(obj.Node);
        });
    }
    if (filter.byDates && filter.byDates.from && filter.byDates.to) {
        results = results.filter(obj => {
            return (
                parseInt(obj.CreationDate) * 1000 > filter.byDates.from.getTime() &&
                parseInt(obj.CreationDate) * 1000 < filter.byDates.to.getTime()
            )
        });
    }
    if (!_.isEmpty(filter.bySpentReceived)) {
        //check if both are set, do nothing
        if (filter.bySpentReceived.length == 1) {
            if (filter.bySpentReceived.includes('Spend')) {
                results = results.filter(obj => {
                    return !obj.isReceived;
                });
            } else {
                results = results.filter(obj => {
                    return obj.isReceived;
                });
            }
        }
    }

    //if empty or all selected, do nothing
    if (!_.isEmpty(filter.byTransactionType) && filter.byTransactionType.length != allTransactionTypes.length) {
        results = results.filter(obj => {
            let retval = false;

            if (!retval && filter.byTransactionType.includes('Invoice')) {
                if (obj.Type == 'invoice') { retval = true; }
            }

            if (!retval && filter.byTransactionType.includes('Fund')) {
                if (obj.Type == 'transaction' && obj.isReceived) { retval = true; }
            }
            if (!retval && filter.byTransactionType.includes('Withdraw')) {
                if (obj.Type == 'transaction' && !obj.isReceived) { retval = true; }
            }

            //TODO: check what is required for direct and fee
            if (!retval && filter.byTransactionType.includes('Direct')) {
                if (obj.Type == 'direct') { retval = true; }
            }
            if (!retval && filter.byTransactionType.includes('Fees')) {
                if (obj.Type == 'fees') { retval = true; }
            }


            return retval;
        });
    }
    if (!_.isEmpty(filter.byStatus) && filter.byStatus.length != allTransactionStatus.length) {
        results = results.filter(obj => {
            let retval = false;

            //TODO: check paid, unpaid and pending and expired
            if (!retval && filter.byStatus.includes('Paid')) {
                if (obj.Status == 'paid' || obj.Status == 'settled') { retval = true; }
            }
            if (!retval && filter.byStatus.includes('Unpaid')) {
                if (obj.Status == 'unpaid') { retval = true; }
            }
            if (!retval && filter.byStatus.includes('Pending')) {
                if (obj.Status == 'open') { retval = true; }
            }
            if (!retval && filter.byStatus.includes('Expired')) {
                if (obj.Status == 'expired') { retval = true; }
            }

            return retval;
        });
    }

    return results;
}

export default function TransactionsPageReducer(state = initialState, action) {
    switch (action.type) {
        case TRANSACTIONS_APPLY_FILTER:
            return {
                ...state,
                filter: action.payload.fiter,
                filteredTransactions: applyFilter(state.transactions, action.payload.fiter)
            };
        case TRANSACTIONS_GET_ALL:
            return {
                ...state,
                loading: true,
                error: false,
                response: {},
            };
        case TRANSACTIONS_GET_ALL_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                response: action.payload.response,
                rawTransactionData: action.payload.response.data,
                transactions: invoice2transaction(action.payload.response.data),
                filteredTransactions: invoice2transaction(action.payload.response.data),
            };
        case TRANSACTIONS_GET_ALL_FAIL:
            return {
                ...state,
                loading: false,
                error: true,
                errMsg: action.payload.error,
            };
        default:
            return {
                ...state,
            };
    }
}