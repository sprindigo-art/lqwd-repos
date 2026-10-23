/* eslint-disable */
import React, { useEffect, useState } from "react";
import SubscriptionList from "../SubscriptionList/SubscriptionList";
import PrimaryButton from '../Buttons/PrimaryButton'
import { setNodePlan, setActiveStep } from '../../containers/CreateNode/CreateNodeActions'




const SelectPlanStep = ({ step, subscriptions, dispatch }) => {
    const [index, setIndex] = useState(-1);

    return (
        <div className={`create-node-select-plan create-node-step-${step}`}>
            <SubscriptionList subscriptions={subscriptions} onselectedChanged={(index) => setIndex(index)} />
            <div className="d-flex justify-content-end px-3 my-2" >
                <PrimaryButton
                    text='Continue'
                    disabled={index == -1}
                    className='continue-to-next-step-btn'
                    onClick={() => dispatch(setNodePlan({ 
                        plan: {
                            productId: subscriptions[index].rawdata.product.id, 
                            planId: subscriptions[index].rawdata.plans[0].id,
                            price: subscriptions[index].price,
                            subscription: subscriptions[index].rawdata.product.allowedDpType,
                        },
                        step: 2 
                    }))}></PrimaryButton>
            </div>
        </div>
    );
};

export default SelectPlanStep;

