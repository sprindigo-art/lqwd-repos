/* eslint-disable */
import React from 'react';
import NodeBalance from "./NodeBalance";
import BalanceItem from "./BalanceItem";
import './Balance.css';
import inflowIcon from '../../public/icons/dashboard/inflow.svg'
import outflowIcon from '../../public/icons/dashboard/outflow.svg'


export default function Balance({received, sent, currency, allCurrencies, balanceHistory, balance,
                                    selectCurrencyFunc}) {

    let receivedProp = {
        balance: received,
        currency: currency,
        icon: inflowIcon,
        color: '#B7F6B6',
        title: 'Received this month'
    }

    let sentProp = {
        balance: sent,
        currency: currency,
        icon: outflowIcon,
        color: '#FFCBC8',
        title: 'Spent this month'
    }

    console.log(currency.code, currency.rate)

    return (
        <div className="balance-holder">
            <div className="chart-holder">
                <NodeBalance allCurrencies={allCurrencies} balance={balance}
                             currency={currency} balanceHistory={balanceHistory}
                             selectCurrencyFunc={selectCurrencyFunc}/>
            </div>

            <div className="stats-container">
                <div className="stats-card">
                    <BalanceItem prop={receivedProp}/>
                </div>
                <div className="stats-card">
                    <BalanceItem prop={sentProp}/>
                </div>
            </div>
        </div>
    );
}
