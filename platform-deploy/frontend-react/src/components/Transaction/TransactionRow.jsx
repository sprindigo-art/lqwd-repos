/* eslint-disable */
import React from 'react';
import './Transaction.css';
import TransactionItem from "./TransactionItem";


function getTxBadgeColor(transaction){
    if(transaction.type == "Withdraw"){
        return {
            color: "#FEE8C7",
            type: transaction.type,
        };
    }else  if(transaction.type == "Unpaid"){
        return {
            color: "#FFCBC8",
            type: transaction.type,
        };
    } else  if(transaction.type == "Paid"){
        return {
            color: "#B7F6B6",
            type: transaction.type,
        };
    }
    else{
        return {
            color: "#D7F0FF",
            type: transaction.type,
        };
    }
}

export default function TransactionRow({date, transactions}) {

    return (

        <div className="d-flex flex-column">
            <div className="p-2 transaction-item-amt">
                {date}
            </div>
            {transactions.map((item, num) => (
                <TransactionItem key={num} title={item.title.replace(/(.{13})..+/, "$1…")} amt={item.amt} typeColor={getTxBadgeColor(item).color}
                                 type={getTxBadgeColor(item).type}/>
            ))}
            <hr className="divider-custom"/>
        </div>


    );
}
