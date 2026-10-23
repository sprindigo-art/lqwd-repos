/* eslint-disable */
import React from 'react';
import './DashboardNode.css';


export default function NodeStatusBadge({color, text}) {

    return (
        <span style={{background: color}} className="badge badge-pill badge-status px-2">{text}</span>
    );
}
