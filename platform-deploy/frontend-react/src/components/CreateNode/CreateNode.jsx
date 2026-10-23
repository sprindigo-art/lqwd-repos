/* eslint-disable */
import './CreateNode.sass';
import React, { useEffect, useState } from "react";
import { Box, Step, StepLabel, Stepper } from "@mui/material";
import { createTheme, ThemeProvider, styled } from '@mui/material/styles';
import SelectPlanStep from './SelectPlanStep'
import NodeInfoStep from './NodeInfoStep'
import SelectPaymentStep from './SelectPaymentStep'
import PaymentStep from './PaymentStep'
import CreateNodeSteps from './Steps'
import BlockUi from 'react-block-ui';
import { hideCreateNodeModal, dontShowHintEverAgain } from '../../containers/CreateNode/CreateNodeActions'
import { Steps, Hints } from 'intro.js-react';
import { hintsForStep1, hintsForStep2, hintsForStep3 } from './CreateNodeHints'

const CustomStepper = styled(Stepper)(({ theme }) => ({
    // "& .MuiStepLabel-iconContainer .Mui-active": { color: "red" },
    "& .MuiStepLabel-iconContainer .Mui-completed": { color: theme.stepper.iconColor },
    // "& .Mui-disabled .MuiStepIcon-root": { color: "cyan" },
}));



const CreateNode = (props) => {
    let { onCreateNode, paymentAddress, dispatch, createNodeReducer } = props;
    const [info, setInfo] = useState({
        lndNetwork: "",
        breezLnd: false,
        alias: "",
        keySendEnabled: false,
        isNonCustodial: false,
        routingNode: false,
        hybridNode: false,
    });

    let activeStep = createNodeReducer.activeStep || 1;

    const [tour1, setTour1] = useState(true );
    const [tour2, setTour2] = useState(true );
    const [tour3, setTour3] = useState(true );
    const [tour4, setTour4] = useState(true );

    const onPaymentSelected = (index) => {
        onCreateNode({
            paymentMethodIndex: index
        });
    }

    return (

        <div className={`create-node create-node-active-step-${activeStep}`}>
            <Box sx={{ width: '100%' }} className="">

                <div className="my-3">
                    <CustomStepper activeStep={activeStep - 1}>
                        {CreateNodeSteps.map((label, index) => {
                            const stepProps = {};
                            const labelProps = {};
                            return (
                                <Step
                                    key={label} {...stepProps}>
                                    <StepLabel {...labelProps}>{label}</StepLabel>
                                </Step>
                            );
                        })}
                    </CustomStepper>
                </div>

                <div className="my-3">

                    <BlockUi tag="div" blocking={createNodeReducer.blocking == true}>
                        <Steps
                            enabled={!createNodeReducer.dontShowHintAgain}
                            steps={createNodeReducer.activeStep == 1 ? hintsForStep1 : createNodeReducer.activeStep == 2 ? hintsForStep2: hintsForStep3}
                            initialStep={0}
                            onExit={() => { if (createNodeReducer.activeStep == 3) dispatch(dontShowHintEverAgain()); }}
                        />

                        <SelectPlanStep step={1} {...props} ></SelectPlanStep>
                        <NodeInfoStep step={2} {...props} ></NodeInfoStep>
                        <SelectPaymentStep step={3} {...props} onPaymentSelected={onPaymentSelected}></SelectPaymentStep>

                        <PaymentStep
                            step={4} {...props}
                            satAmount={createNodeReducer.payment.amount}
                            amount={createNodeReducer.payment.amountUsd}
                            btcRate={createNodeReducer.payment.rateUsd}
                            address={createNodeReducer.address}
                            startDate={createNodeReducer.payment.startDate}
                            endDate={createNodeReducer.payment.endDate}
                            onFinish={() =>  { dispatch(hideCreateNodeModal()); dispatch(dontShowHintEverAgain()); }}>

                        </PaymentStep>
                    </BlockUi>

                </div>
            </Box>
        </div>

    );
};

export default CreateNode;

