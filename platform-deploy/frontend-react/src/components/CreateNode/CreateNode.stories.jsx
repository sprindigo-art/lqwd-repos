/* eslint-disable */
import React from 'react';
import CreateNode from "./CreateNode";
import { useArgs } from '@storybook/client-api';
import PaymentStep from "./PaymentStep";
import { hideCreateNodeModal } from "../../containers/CreateNode/CreateNodeActions";

export default {
    title: 'LQWD Node/ Create Node',
    component: CreateNode,
    argTypes: {
        currentstep: {
            control: {
                type: 'number',
                min: 0,
                max: 3,
                step: 1
            }
        }
    }
};


export const primary = (args) => {

    let paymentAddress = 'd0d2b817f643eb8a978574c932150571746c59924a72db337d38d904cb79de95c754de09e58db655c7a276263a1b1646a726c4a0bb4bce5a74474ece962f3eced0d2b817f643eb8a978574c932150571746c59924a72db337d38d904cb79de95c754de09e58db655c7a276263a1b1646a726c4a0bb4bce5a74474ece962f3ece';
    const [{ status }, updateArgs] = useArgs();

    const goBack = (step, data) => {
        updateArgs({ currentstep: step -1 - 1 })
    }

    const goToStep = (step) => {
        updateArgs({ currentstep: step - 1 })
    }

    const onCreateNode = ({info, plan}) => {
        console.log(`create node with ${JSON.stringify(info)} and with "${plan.name}" plan`)
        updateArgs({ currentstep: 2 })
    }


    return (
        <div>
            <CreateNode
              onFinish={() => updateArgs({currentstep: 0 })}
              paymentAddress={paymentAddress}
              onCreateNode={onCreateNode}
              goBack={goBack}
              goToStep={goToStep}
              activeStep={args.currentstep} />
        </div>
    )
}
