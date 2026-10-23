/* eslint-disable */
import React from 'react';
import SubscriptionItem from "./SubscriptionItem";
import subscriptionsExample from './SubscriptionStorybookExample'


const onItemSelect = () => {
    console.log('onItemSelect')
}

export default {
    title: 'LQWD Subscription/ Subscription Item',
    component: SubscriptionItem,
};

export const primary = () => {

    return (
    <div >
        <SubscriptionItem item={subscriptionsExample[0]} selected={false} onItemSelect={onItemSelect} />
    </div>
    )
}

export const selected = () => {

    return (
    <div >
        <SubscriptionItem item={subscriptionsExample[0]} selected={true} onItemSelect={onItemSelect} />
    </div>
    )
}