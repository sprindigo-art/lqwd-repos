/* eslint-disable */
import React from 'react';
import './NodeDetails.css';
import CopyText from "../CopyText/CopyText";


export default function CopyNodeDetailsItem({title, value}) {

    return (

    <div className="row justify-content-between">
        <div className="p-2 col-md-4 detail-item-key">{title}</div>
        <div className="p-2 col-md-8 ml-auto detail-item-value">
            <CopyText text={value}/>
        </div>
    </div>

    );
}
