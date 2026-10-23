/* eslint-disable */
import React from 'react';
import './ChannelBalance.css';

function calculatePercentage(num1, num2) {

    if (num1 > num2) {
        return (num2 * 100) / (num1+num2);
    }

    return (num1 * 100) / (num1+num2);
}


export default function ChannelBalance({ remoteBalance, localBalance, currency, chanProgressBg }) {

    let percentage = calculatePercentage(Number(remoteBalance), Number(localBalance));

    return (
        <div className="container">
            <div className="row">
            <div className="d-flex flex-row justify-content-between p-0 my-1">
                <div className="p-0 channel-balance-title">
                    Remote Balance
                </div>

                <div className="p-0 channel-balance-title">
                    Your Balance
                </div>
            </div>
            </div>
            <div className="row">
                <div className={chanProgressBg != null ? "progress p-0" : "progress chan-progress p-0"} style={chanProgressBg}>
                    <div className="progress-bar chan-progress-bg " role="progressbar"
                        style={{ width: `${percentage}%`, ariaValuenow: `${percentage}`, ariaValuemin: "0", ariaValuemax: "100" }}></div>
                </div>
            </div>
            <div className="row">
                <div className="d-flex flex-row justify-content-between p-0 my-1">
                    <div className="p-0 remote-balance">
                        {parseInt(remoteBalance).toLocaleString(undefined, {maximumFractionDigits: 2})} {currency}
                    </div>

                    <div className="p-0 remote-balance">
                        <b>{parseInt(localBalance).toLocaleString(undefined, {maximumFractionDigits: 2})}</b> {currency}
                    </div>
                </div>

            </div>
        </div>
    );
}
