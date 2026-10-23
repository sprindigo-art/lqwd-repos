/* eslint-disable */
import React from 'react';
import './TransactionFeeRates.css'
import TransactionFeeItem from './TransactionFeeItem';

export default function TransactionFeeRates() {


    return (
        <div className="container">
            <div className="row">
                <div className='col-12 transaction-fee-rates-container'>
                    <div className='my-2'>
                        <h1>Transaction Fee Rates</h1>
                    </div>
                    <div className='my-2'>
                        The speed of transaction will be processed and prioritized
                    </div>


                    <TransactionFeeItem className='my-2' priority='low' rate='1'></TransactionFeeItem>
                    <TransactionFeeItem className='my-2' priority='medium' rate='2'></TransactionFeeItem>
                    <TransactionFeeItem className='my-2' priority='high' rate='3'></TransactionFeeItem>
                </div>

            </div>

        </div>
    );
}