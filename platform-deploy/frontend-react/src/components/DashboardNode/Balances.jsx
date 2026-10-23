/* eslint-disable */
import React from 'react';
import './Balances.css';


export default function Balances({title, body, disabled}) {

    return (
                <div className="d-flex flex-column my-2">
                    <div className="pb-1 dropdown node-balance-title text-end">
                        {title}
                    </div>
                    <div style={disabled ? {color:"#B2B2B2"} : {}} className="pt-1 node-balance-body text-end">
                        {body}
                    </div>
                </div>
            );
}
