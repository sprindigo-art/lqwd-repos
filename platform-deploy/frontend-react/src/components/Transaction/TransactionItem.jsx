/* eslint-disable */
import React from 'react';
import './Transaction.css';
import NodeStatusBadge from "../DashboardNode/NodeStatusBadge";


export default function TransactionItem({title, amt, type, typeColor}) {

    return (

        <div className="d-flex flex-row justify-content-between">
            <div className="p-2 flex-column">
                <div className="transaction-item-title">{title}</div>
                <div className="transaction-item-amt">{amt} sats</div>
            </div>
            <div className="p-2">
                <NodeStatusBadge color={typeColor} text={type}/>
            </div>
        </div>


    );
}
