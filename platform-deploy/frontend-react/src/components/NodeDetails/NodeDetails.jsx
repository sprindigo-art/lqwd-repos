/* eslint-disable */
import React from 'react';
import './NodeDetails.css';
import PrimaryButton from "../Buttons/PrimaryButton";
import DangerButton from "../Buttons/DangerButton";
import NodeDetailsItem from "./NodeDetailsItem";
import CopyNodeDetailsItem from "./CopyNodeDetailsItem";
import NodeStatusBadge from "../DashboardNode/NodeStatusBadge";
import { Modal } from "react-bootstrap";
import { getNodeAttributes } from '../Node/NodeAttributes'
import NodeDetailsRunning from './NodeDetailsRunning'
import NodeDetailsConfirmation from './NodeDetailsConfirmation'
import NodeDetailsCreating from './NodeDetailsCreating'
import NodeDetailsPending from './NodeDetailsPending'
import NodeDetailsEmpty from './NodeDetailsEmpty'
import VectorImg from '../../public/icons/general/png/Vector.png';



export default function NodeDetailsModal({ status, ...rest }) {
    let { show, handleClose, data, selectedNode, fundNodeAction, activateNodeAction, deleteNodeAction, restartNodeAction } = rest;

    const rednderNodeDetials = () => {
        switch (status) {
            case 'RUNNING':
                return (<NodeDetailsRunning {...rest} onDeleteClick={() => deleteNodeAction(selectedNode.lndNodeName)} />);
                break;
            case 'IS_WAITING_USER_CONFIRMATION':
                return (<NodeDetailsConfirmation {...rest} onDeleteClick={() => deleteNodeAction(selectedNode.lndNodeName)} onActivate={activateNodeAction} />);
                break;
            case 'CREATING':
                return (<NodeDetailsCreating {...rest} onDeleteClick={() => deleteNodeAction(selectedNode.lndNodeName)} />);
                break;
            case 'PENDING':
                return (<NodeDetailsPending {...rest} onDeleteClick={() => deleteNodeAction(selectedNode.lndNodeName)} />);
                break;
            default:
                return (<NodeDetailsEmpty {...rest} onDeleteClick={() => deleteNodeAction(selectedNode.lndNodeName)} />);
                break;
        }
    }

    return (
        <>
            <Modal centered size="lg" show={show} onHide={handleClose} backdrop='static' keyboard="False">
                <Modal.Header closeButton className="cus-header">
                    <div id="exampleModalLabel" className="flex-column cus-sub-header justify-content-around">
                        <div className="d-sm-flex flex-row align-items-center">
                            <div className="details-title">
                                {selectedNode.status == "IS_WAITING_USER_CONFIRMATION" ? <img className='ms-1 me-2' src={VectorImg} alt="" /> : <></>}
                                {selectedNode.alias != null && selectedNode.alias !== "" ? selectedNode.lndNodeName + ": " + selectedNode.alias : selectedNode.lndNodeName}
                            </div>
                            <div className="details-badge">
                                <NodeStatusBadge text={getNodeAttributes(selectedNode.status).badge_text} color={getNodeAttributes(selectedNode.status).badge_color} />
                            </div>

                        </div>
                        <div className="details-connection p-2">
                            active connection: {data != null ? data.num_peers : 0}
                        </div>
                        <div className={"p-2 " + (status == "IS_WAITING_USER_CONFIRMATION" ? "d-none" : "")}>
                            <PrimaryButton
                                text='Fund Node'

                                disabled={status == 'CREATING' || status == 'PENDING'}

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
                        </div>
                        <div className='p-2'>
                            <DangerButton
                                text={status != 'IS_AWAITING_WALLET_UNLOCK' ? 'Restart Node' : 'Unlock Wallet'}
                                className='create-btn d-none d-md-block'
                                onClick={() => restartNodeAction(selectedNode.lndNodeName, selectedNode.isNonCustodial, selectedNode.status)}
                            />
                        </div>


                    </div>
                </Modal.Header>

                {rednderNodeDetials()}


            </Modal>

        </>
    );
}
