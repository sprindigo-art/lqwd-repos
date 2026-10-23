/* eslint-disable */
import React from 'react';
import './NodeDetails.css';


export default function NodeDetailsItem({title, value, titleColor, valueColor}) {

    return (
        <div className="row justify-content-between">
            <div style={{color: titleColor || "#7A7A7A"}} className="p-2 col-auto detail-item-key">{title}</div>
            <div style={{color: valueColor || "#111111"}} className="p-2 col-auto ml-auto detail-item-value">{value}</div>
        </div>


    );
}
