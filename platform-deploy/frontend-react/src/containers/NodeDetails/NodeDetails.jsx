/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import NodeDetailsComponent from '../../components/NodeDetails/NodeDetails';
import {createDepositAddress, showFundNodeModal} from "../FundNode/FundNodeActions";
import { hideNodeDetailsModal } from './NodeDetailsActions';
import { showActivateModal, getSeeds } from '../ActivateNode/ActivateNodeActions';
import {findNodeByName, findNodeInfosByName} from '../../managers/nodeManager/nodeManager'
import {showDeleteNodeModal} from '../DeleteNode/DeleteNodeActions'
import {showRestartNodeModal} from "../RestartNode/RestartNodeActions";
import AuthorizeModal from "../../components/Auth/AuthorizeModal/AuthorizeModal";

const NodeDetails = ({...rest}) => {
    const dispatch = useDispatch();
    const nodeReducer = useSelector(state => state.nodeReducer);
    const nodeDetailsModal = useSelector(state => state.nodeDetailsReducer);

    let selectedNode = findNodeByName(nodeReducer.nodeList, nodeDetailsModal.nodeName);
    if (selectedNode == null && nodeReducer.sharedNodeList !== undefined){
        selectedNode = findNodeByName(nodeReducer.sharedNodeList, nodeDetailsModal.nodeName);
    }

    const activateModalShow = useSelector(state => state.activateReducer.showModal);
    const deleteNodeModalShow = useSelector(state => state.deleteNodeReducer.showModal);
    const fundNodeModalShow = useSelector(state => state.fundNodeReducer.showModal);
    const restartNodeModalShow = useSelector(state => state.restartNodeReducer.showModal);

    let nodeInfo = findNodeInfosByName(nodeReducer.nodeInfos, nodeDetailsModal.nodeName);

    if (nodeInfo === undefined && nodeReducer.sharedNodeInfos != null){
        nodeInfo = findNodeInfosByName(nodeReducer.sharedNodeInfos, nodeDetailsModal.nodeName);
    }

    const [showAuthorizeModal, setShowAuthorizeModal] = useState(false);
    const [depositNodeName, setDepositNodeName] = useState('');
    const [nonCustodial, setNonCustodial] = useState(false);

    if (!selectedNode) return (<></>);

    const handleClose = () => {
        dispatch(hideNodeDetailsModal());
    }

    const showFundNode = (nodeName, isNonCustodial) => {
        console.log(nodeName, isNonCustodial);
        setNonCustodial(isNonCustodial);
        setDepositNodeName(nodeName);
        setShowAuthorizeModal(true);
    };

    const authorizeCreateDepositAddress = (password, passphrase) => {
        console.log(depositNodeName, password, passphrase);
        setShowAuthorizeModal(false);
        if (nonCustodial){
            dispatch(createDepositAddress(depositNodeName, password, passphrase))
            dispatch(showFundNodeModal(depositNodeName))
        }else{
            dispatch(createDepositAddress(depositNodeName, password))
            dispatch(showFundNodeModal(depositNodeName))
        }
    };

    const showDeleteNode = (nodeName) => {
        dispatch(showDeleteNodeModal(nodeName))
    }

    const activateNode = () => {
        console.log('onActivate');
        dispatch(showActivateModal())
        dispatch(getSeeds(selectedNode))
    };

    return (
        <>
            <NodeDetailsComponent
                show={nodeDetailsModal.showModal && !showAuthorizeModal && !activateModalShow && !deleteNodeModalShow && !fundNodeModalShow && !restartNodeModalShow}
                fundNodeAction={(nodeName, isNonCustodial) => showFundNode(nodeName, isNonCustodial)}
                selectedNode={selectedNode}
                deleteNodeAction={showDeleteNode}
                handleClose={handleClose}
                status={selectedNode.status}
                data={nodeInfo? nodeInfo.info : null}
                nodeBalance={nodeInfo? nodeInfo.balance : null}
                activateNodeAction={activateNode}
                restartNodeAction={(nodeName,isNonCustodial, status) => dispatch(showRestartNodeModal(nodeName,isNonCustodial, status))}
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

export default NodeDetails;