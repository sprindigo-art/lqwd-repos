/* eslint-disable */
import React, { useEffect } from "react";
import './DashboardNode.css';
import Balances from "./Balances";
import PrimaryButton from "../Buttons/PrimaryButton";
import DangerButton from "../Buttons/DangerButton";
import InfoPanel from '../InfoPanel/InfoPanel';
import NodeStatusBadge from "./NodeStatusBadge";
import { getNodeAttributes } from '../Node/NodeAttributes'
import VectorImg from '../../public/icons/general/png/Vector.png';
import Link from '@mui/material/Link';



export default function DashboardNode({ viewNodeDetailCallback,
    nodes, selectedNode, selectNode, nodeBalance, fundNodeAction, activateNodeAction, restartNodeAction, showSubscriptionInvoiceAction }) {

    if (!selectedNode) return (<></>);

    const renderActions = (state) => {
        switch (state) {
            case 'IS_WAITING_USER_CONFIRMATION':
                return (
                    <>
                        <div className="p-2">
                            <PrimaryButton
                                text='Activate'
                                className='create-btn'
                                onClick={activateNode}
                            />
                        </div>
                    </>
                )
                break;
            case 'NEED_RESTART':
                return (
                    <>
                        <div className="d-none d-md-block p-2">
                            <DangerButton
                                text='Restart Node'
                                className='create-btn'
                                onClick={() => restartNodeAction(selectedNode.lndNodeName, selectedNode.isNonCustodial, selectedNode.status )}
                            />
                        </div>
                        <div className="p-2 mt-auto" >
                            <InfoPanel
                                error={true} text="Technical problems occur, please restart the node."
                            />
                        </div>
                    </>
                )
                break;
            case 'RESTARTING':
                return (
                    <>
                        <div className="p-2">
                            <DangerButton
                                text='Restarting'
                                className='create-btn'
                            />
                        </div>
                        <div className="p-2 mt-auto" >
                            <InfoPanel
                                warn={true} text="Restarting node takes a few minutes, you don’t need to stay on this page, we will take care of it."
                            />
                        </div>
                    </>
                )
                break;
            default:
                return (
                    <>
                        <div className="d-flex p-2">
                            <PrimaryButton
                                text='Fund Node'
                                disabled={selectedNode.status != "RUNNING"}
                                className='create-btn'
                                icon={
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="32"
                                        height="32"
                                        fill="currentColor"
                                        className="bi bi-plus"
                                        viewBox="0 0 16 16"
                                    >
                                        <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z" />
                                    </svg>
                                }
                                onClick={() => fundNodeAction(selectedNode.lndNodeName, selectedNode.isNonCustodial)}
                            />
                            <DangerButton
                                text={state != 'IS_AWAITING_WALLET_UNLOCK' ? 'Restart Node' : 'Unlock Wallet'}
                                className='create-btn mx-2 d-none d-md-block'
                                onClick={() => restartNodeAction(selectedNode.lndNodeName, selectedNode.isNonCustodial, selectedNode.status)}
                            />
                        </div>
                    </>
                )
                break;
        }
    }

    const activateNode = () => {
        activateNodeAction(selectedNode);
    };
    console.log(selectedNode);
    return (
      <div>
        <div className="tag-holder d-flex justify-content-end">
            <NodeStatusBadge text={getNodeAttributes(selectedNode.status).badge_text} color={getNodeAttributes(selectedNode.status).badge_color} />
        </div>
        <div className="card border-0">
            <div className="card-body pt-1">
                {!selectedNode.paid ?
                    <div className={"d-none d-md-block"}
                        style={{ width: '100%', background: '#FFD580', color: 'black', borderRadius: '5px', textAlign: 'center', marginTop: '5px' }}
                    > {selectedNode.status == "IS_WAITING_USER_CONFIRMATION" ?
                          "Please activate within 25 minutes and pay this node after activated." :
                          "Please pay this node before it is deleted."}
                        &nbsp;
                        <Link
                            component="button"
                            variant="body2"
                            onClick={() => showSubscriptionInvoiceAction(selectedNode.lndNodeName)}
                        >
                            Click here to see the invoice again.
                        </Link>
                        &nbsp;
                    </div>
                  :
                  <></>
                }
                <div className="d-sm-flex justify-content-between">
                    <div className="d-flex flex-column justify-content-between">
                        <div className="p-2 dropdown node-select">
                            {selectedNode.status == "IS_WAITING_USER_CONFIRMATION" ? <img className='ms-1 me-2' src={VectorImg} alt="" /> : <></>}
                            <div className="dropdown-toggle" id="dropdownMenuButton1" style={nodes != null ? { cursor: 'pointer', display: "flex" } : {}}
                                data-bs-toggle={nodes != null ? "dropdown" : ""} aria-expanded="false">
                                {selectedNode.alias != null && selectedNode.alias !== "" ? selectedNode.alias : selectedNode.lndNodeName}
                                {
                                    selectedNode.nodeRole != null ?
                                      <div className={"shared-role-status"}>Role: {selectedNode.nodeRole}</div>
                                      :
                                      <></>
                                }
                            </div>
                            {nodes != null ?
                                <>
                                    <ul className="dropdown-menu" aria-labelledby="dropdownMenuButton1">
                                        {nodes.map((item) => (
                                            <li key={item.id}>
                                                <a className="dropdown-item" href="#"
                                                    onClick={() => selectNode(item.lndNodeName)}>{item.alias != null && item.alias !== "" ? item.alias : item.lndNodeName}</a>
                                            </li>))}

                                    </ul>
                                    <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M6 5.07101L2.179 1.25001C1.765 0.836014 1.093 0.836014 0.679 1.25001C0.265 1.66401 0.265 2.33601 0.679 2.75001L5.293 7.36401C5.684 7.75501 6.317 7.75501 6.707 7.36401L11.321 2.75001C11.735 2.33601 11.735 1.66401 11.321 1.25001C10.907 0.836014 10.235 0.836014 9.821 1.25001L6 5.07101Z" fill="#4D4D4D" />
                                    </svg></> : <></>}
                        </div>


                        {renderActions(selectedNode.status)}
                        <div className="p-2 mt-auto" onClick={() => viewNodeDetailCallback(selectedNode.lndNodeName, selectedNode)}>
                            <p className="btn details">
                                View node details   <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"
                                    fill="currentColor" className="bi bi-arrow-right"
                                    viewBox="0 0 16 16">
                                    <path fillRule="evenodd"
                                        d="M1 8a.5.5 0 0 1 .5-.5h11.793l-3.147-3.146a.5.5 0 0 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L13.293 8.5H1.5A.5.5 0 0 1 1 8z" />
                                </svg></p>
                        </div>

                    </div>
                    <div className="d-flex flex-column">
                        <Balances disabled={selectedNode.status != "RUNNING"} title={'Confirmed Balance'} body={nodeBalance != null ? nodeBalance.confirmed_balance || '00.00' + ' sats' : '00.00' + ' sats'} />
                        <Balances disabled={selectedNode.status != "RUNNING"} title={'Unconfirmed Balance'} body={nodeBalance != null ? nodeBalance.unconfirmed_balance || '00.00' + ' sats' : '00.00' + ' sats'} />
                        <Balances disabled={selectedNode.status != "RUNNING"} title={'Total Balance'} body={nodeBalance != null ? nodeBalance.total_balance || '00.00' + ' sats' : '00.00' + ' sats'} />
                    </div>
                </div>
            </div>
        </div>

    </div>);
}
