/* eslint-disable */
import React from 'react';
import SubscriptionList from "./SubscriptionList";
import subscriptionsExample from '../SubscriptionItem/SubscriptionStorybookExample'

export default {
    title: 'LQWD Subscription/ Subscription List',
    component: SubscriptionList,
};

const onselectedChanged = (item) => { console.log(`${item.name} is selected now`)}

export const primary = () => {

    return (
    <div >
        <SubscriptionList subscriptions={subscriptionsExample} onselectedChanged={onselectedChanged}/>
    </div>
    )
}