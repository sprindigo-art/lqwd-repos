/* eslint-disable */
import React from 'react';
import './Transaction.css';
import EmptyTransactionsImg from '../../public/icons/dashboard/transactions/empty-recent-transaction.png';


export default function TransactionEmpty({text}) {

    return (

        <div className="flex-grow-1">
            <div className="d-flex justify-content-center h-100">
                <div className="d-flex justify-content-center flex-column w-100">
                    <img src={EmptyTransactionsImg} alt="No Transactions"/>

                    <div className="transactions-message">
            <span className="transactions-message-text mt-3">
              {text}
            </span>
                    </div>
                </div>
            </div>
        </div>


    );
}
