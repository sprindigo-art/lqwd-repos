/* eslint-disable */
import React, { useState, useEffect } from 'react';
import './Node.css'
import { useSelector, useDispatch } from 'react-redux';
import NodeComponent from '../../components/DashboardNode/DashboardNode';
import { showActivateModal, getSeeds } from '../ActivateNode/ActivateNodeActions'
import { changeSelectedNode } from '../../managers/nodeManager/nodeActions';
import { createDepositAddress, showFundNodeModal } from "../FundNode/FundNodeActions";
import { showNodeDetailsModal } from '../NodeDetails/NodeDetailsActions'
import { getNodeChannels } from "../Dashboard/DashboardActions";
import { showRestartNodeModal } from "../RestartNode/RestartNodeActions";
import AuthorizeModal from "../../components/Auth/AuthorizeModal/AuthorizeModal";
import { getSubscriptionInvoice } from '../../containers/SubscriptionInvoiceModal/SubscriptionInvoiceModalReducer'


const Node = ({ ...rest }) => {

    const dispatch = useDispatch();

    const [showAuthorizeModal, setShowAuthorizeModal] = useState(false);

    const [depositNodeName, setDepositNodeName] = useState('');

    const [nonCustodial, setNonCustodial] = useState(false);

    const activateNodeAction = (selectedNode) => {
        dispatch(showActivateModal())
        dispatch(getSeeds(selectedNode))
    };

    const selectNodeAction = (selectedNodeName) => {
        dispatch(changeSelectedNode(selectedNodeName))
        dispatch(getNodeChannels(selectedNodeName))
    };

    const showFundNode = (nodeName, isNonCustodial) => {
        console.log(nodeName, isNonCustodial);
        setNonCustodial(isNonCustodial);
        setDepositNodeName(nodeName);
        setShowAuthorizeModal(true);
    };

    const authorizeCreateDepositAddress = (password, passphrase) => {
        console.log(depositNodeName, password, passphrase);
        setShowAuthorizeModal(false);
        if (nonCustodial) {
            dispatch(createDepositAddress(depositNodeName, password, passphrase))
            dispatch(showFundNodeModal(depositNodeName))
        } else {
            dispatch(createDepositAddress(depositNodeName, password))
            dispatch(showFundNodeModal(depositNodeName))
        }
    };


    const nodeDetailsShow = (nodeName, node) => {
        console.log(nodeName, node);
        dispatch(showNodeDetailsModal(nodeName))
    };

    return (
        <>
            <NodeComponent
                activateNodeAction={activateNodeAction}
                selectNode={selectNodeAction}
                fundNodeAction={(nodeName, isNonCustodial) => showFundNode(nodeName, isNonCustodial)}
                viewNodeDetailCallback={nodeDetailsShow}
                restartNodeAction={(nodeName, isNonCustodial, status) => dispatch(showRestartNodeModal(nodeName, isNonCustodial, status))}
                showSubscriptionInvoiceAction={(nodeName) => dispatch(getSubscriptionInvoice({nodeName}))}
                {...rest}
            />
            <AuthorizeModal
                show={showAuthorizeModal}
                handleConfirm={authorizeCreateDepositAddress}
                goBack={() => setShowAuthorizeModal(false)}
                handleHide={() => setShowAuthorizeModal(false)}
                isNonCustodial={nonCustodial}
            />
        </>
    );
};

export default Node;
