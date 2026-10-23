/* eslint-disable */
import React from 'react';
import PaymentStep from "./PaymentStep";

export default {
    title: 'LQWD Node/ Steps / Payment',
    component: PaymentStep,
};

let createNodeReducer = {
    address: 'd0d2b817f643eb8a978574c932150571746c59924a72db337d38d904cb79de95c754de09e58db655c7a276263a1b1646a726c4a0bb4bce5a74474ece962f3eced0d2b817f643eb8a978574c932150571746c59924a72db337d38d904cb79de95c754de09e58db655c7a276263a1b1646a726c4a0bb4bce5a74474ece962f3ece',
    plan: {
        price: '0.000002 B'
    }
}

export const primary = () => {

    return (
        <div>
            <PaymentStep createNodeReducer={createNodeReducer}
            address={createNodeReducer.address}
                         satAmount={88980}
                         amount={24.99}
                         btcRate={28086.59123123}
                         startDate={"2023-04-06T17:59:12.297+00:00"}
                         endDate={"2023-04-30T17:59:12.297+00:00"} />
        </div>
    )
}