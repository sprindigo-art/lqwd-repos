/* eslint-disable */
import React from 'react';
import './BalanceItem.css';

const formatNumber = (num, currency) => {
    let convertedBal = num * currency.rate
    return convertedBal.toLocaleString('en-US', {
        minimumFractionDigits: 2
    })
}

export default function BalanceItem({prop}) {

    return (
                <div className="d-inline-flex flex-row">
                    <div className="align-content-center">
                        <div className="p-2 item-icon-holder" style={{backgroundColor: prop.color}}>
                            <img
                                src={prop.icon}
                            />
                        </div>
                    </div>
                    <div className="p-2">
                        <div className="row item-title">
                            <p>{prop.title}</p>
                        </div>
                        <div className="row item-amt">
                            <h2>{formatNumber(prop.balance, prop.currency)} <sub>{prop.currency.code}</sub></h2>
                        </div>
                    </div>

        </div>
    );
}
