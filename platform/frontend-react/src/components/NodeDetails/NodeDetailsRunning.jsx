/* eslint-disable */
import React from 'react';
import './NodeDetails.css';
import NodeDetailsItem from "./NodeDetailsItem";
import CopyNodeDetailsItem from "./CopyNodeDetailsItem";
import { Modal } from "react-bootstrap";

const formatNumber = (num) => {
    return num.toLocaleString('en-US', {
        minimumFractionDigits: 2
    })
}


export default function NodeDetailsRunning({ data, selectedNode, nodeBalance, onDeleteClick }) {
    return (
        <>
            <Modal.Body>

                {data == null ? <div className="p2">Data not available</div> :

                    <div className="flex-column details-container overflow-auto">

                        <div className="p-2 flex-row">
                            <div className="node-details-title">
                                <svg style={{ marginRight: '10px' }} width="20" height="20" viewBox="0 0 20 20"
                                    fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path
                                        d="M1.99024 0.990234C1.84721 0.990266 1.70586 1.02097 1.57571 1.08029C1.44557 1.1396 1.32966 1.22614 1.2358 1.33406C1.14195 1.44198 1.07234 1.56878 1.03166 1.7059C0.99098 1.84301 0.980186 1.98726 1 2.12891V14C1.00005 14.2652 1.10544 14.5195 1.29297 14.707L5.20508 18.6191C5.31471 18.7628 5.46123 18.8741 5.62906 18.9412C5.79689 19.0082 5.97975 19.0286 6.15821 19H18C18.2652 19 18.5196 18.8946 18.7071 18.7071C18.8946 18.5195 19 18.2652 19 18V6.16797C19.0305 5.98866 19.0115 5.80443 18.9451 5.63511C18.8787 5.46579 18.7673 5.31779 18.6231 5.20703C18.6211 5.20572 18.6191 5.20442 18.6172 5.20312L14.707 1.29297C14.5195 1.10543 14.2652 1.00005 14 1H2.11719C2.07512 0.994052 2.03272 0.99079 1.99024 0.990234ZM4.41407 3H13.5859L15.5859 5H6.41407L4.41407 3ZM3 4.41406L5 6.41406V15.5859L3 13.5859V4.41406ZM7 7H17V17H7V7Z"
                                        fill="#4D4D4D" />
                                </svg>
                                Node Details
                            </div>
                        </div>

                        <div className="container-fluid details-holder">
                            <NodeDetailsItem title={'Type'}
                                             value={selectedNode.isNonCustodial ? "Self Managed Node" : "Managed Node"} />
                            <NodeDetailsItem title={'Version'} value={data.version} />
                            <CopyNodeDetailsItem title={'Node info'} value={data.uris != null ? data.uris : ''} />
                            <CopyNodeDetailsItem title={'Identity Pubkey'} value={data.identity_pubkey} />
                            <CopyNodeDetailsItem title={'Commit Hash'} value={data.commit_hash} />
                            <NodeDetailsItem title={'Block Height'} value={data.block_height} />
                            <CopyNodeDetailsItem title={'Block Hash'} value={data.block_hash} />
                            <NodeDetailsItem title={'Watchtower'} value={selectedNode.watchtower} />
                        </div>

                        <hr className="divider-custom" />

                        <div className="p-2 d-none d-md-block">
                            <div className="p-2 flex-row">
                                <div className="node-details-title">
                                    <svg style={{ marginRight: '7px' }} width="20" height="18" viewBox="0 0 20 18"
                                        fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path
                                            d="M17 0C15.355 0 14 1.35499 14 3C14 3.45986 14.1142 3.89194 14.3027 4.2832L10.5859 8H5.8125C5.39514 6.84267 4.29316 6 3 6C1.35499 6 0 7.35499 0 9C0 10.645 1.35499 12 3 12C4.29316 12 5.39514 11.1573 5.8125 10H10.5859L14.3027 13.7168C14.1142 14.1081 14 14.5401 14 15C14 16.645 15.355 18 17 18C18.645 18 20 16.645 20 15C20 13.355 18.645 12 17 12C16.5401 12 16.1081 12.1142 15.7168 12.3027L12.4141 9L15.7168 5.69727C16.1081 5.88578 16.5401 6 17 6C18.645 6 20 4.64501 20 3C20 1.35499 18.645 0 17 0ZM17 2C17.5641 2 18 2.43587 18 3C18 3.56413 17.5641 4 17 4C16.4359 4 16 3.56413 16 3C16 2.43587 16.4359 2 17 2ZM3 8C3.56413 8 4 8.43587 4 9C4 9.56413 3.56413 10 3 10C2.43587 10 2 9.56413 2 9C2 8.43587 2.43587 8 3 8ZM17 14C17.5641 14 18 14.4359 18 15C18 15.5641 17.5641 16 17 16C16.4359 16 16 15.5641 16 15C16 14.4359 16.4359 14 17 14Z"
                                            fill="#4D4D4D" />
                                    </svg>
                                    Channels
                                </div>
                            </div>
                            <div className="container-fluid details-holder">
                                <NodeDetailsItem title={'Number of Pending Channels'} value={data.num_pending_channels} />
                                <NodeDetailsItem title={'Number of Active Channels'} value={data.num_active_channels} />
                                <NodeDetailsItem title={'Number of Inactive Channels'} value={data.num_inactive_channels} />
                                <NodeDetailsItem title={'Number of Peers'} value={data.num_peers} />
                            </div>

                        </div>

                    </div>}

            </Modal.Body>


            <div className="details-footer">
                <div className="flex-row d-none d-sm-flex justify-content-between flex-row-reverse">
                    {nodeBalance == null ? <div></div> :
                        <div className="col-sm-10 flex-end">
                            <div className="d-sm-flex justify-content-between">
                                <div className="p-2 detail-item-key">Confirmed Balance</div>
                                <div className="p-2 ml-auto detail-item-value">{formatNumber(Number(nodeBalance.confirmed_balance)) || '00.00'} sats</div>
                            </div>
                            <div className="d-sm-flex justify-content-between">
                                <div className="p-2 detail-item-key">Unconfirmed Balance</div>
                                <div className="p-2 ml-auto detail-item-value">{formatNumber(Number(nodeBalance.unconfirmed_balance)) || '00.00'} sats</div>
                            </div>
                            <div className="d-sm-flex justify-content-between">
                                <div className="p-2 detail-item-key">Total Balance</div>
                                <div className="p-2 ml-auto detail-item-value">{formatNumber(Number(nodeBalance.total_balance)) || '00.00'} sats</div>
                            </div>
                        </div>
                    }
                    <svg onClick={() => onDeleteClick()} style={{ cursor: 'pointer' }} width="18" height="20" className="footer-icon" viewBox="0 0 18 20" fill="none"
                        xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="M7 0L6 1H0V3H1.10938L2.90234 18.2344C3.01959 19.234 3.882 20 4.88867 20H13.1113C14.118 20 14.9804 19.234 15.0977 18.2344L16.8906 3H18V1H16H12L11 0H7ZM3.12305 3H4H14.877L13.1113 18H4.88867L3.12305 3ZM6 5V15C6 15.552 6.448 16 7 16H8V5H6ZM10 5V16H11C11.552 16 12 15.552 12 15V5H10Z"
                            fill="#F84949" />
                    </svg>
                </div>

            </div>

        </>
    );
}
