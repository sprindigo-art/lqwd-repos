/* eslint-disable */
import React, { useState } from 'react';
import './SubscriptionList.sass'
import SubscriptionItem from '../SubscriptionItem/SubscriptionItem';


export default function SubscriptionList({ subscriptions, onselectedChanged }) {
    // const [selected, setResult] = useState(new Array(subscriptions.length).fill(true).fill(false, 1));
    const [selected, setResult] = useState(new Array(subscriptions.length).fill(false));

    const valuechanged = (index, item) => {
        let newval = new Array(subscriptions.length).fill(false);
        newval[index] = true;
        setResult(newval);
        onselectedChanged(index);
    }

    return (
        <div className='d-flex subscription-item-list-container py-2'>
            {subscriptions.map((item, index) => (
                <div className='mx-2'>
                    <SubscriptionItem item={item} selected={selected[index]} onItemSelect={() => valuechanged(index, item)}></SubscriptionItem>
                </div>
            ))}

        </div>
    );
}