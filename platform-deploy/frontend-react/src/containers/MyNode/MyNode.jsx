/* eslint-disable */
import './MyNode.css';
import React, {useEffect, useState} from "react";
import PrimaryButton from "../../components/Buttons/PrimaryButton";
import Node from "../Node/Node";
import {useDispatch, useSelector} from "react-redux";
import EmptyNode from "../../components/NodeEmpty/NodeEmpty";
import { getNodeList, getSharedNodeList } from "../../managers/nodeManager/nodeActions";
import { showCreateNodeModal } from "../CreateNode/CreateNodeActions";
import { useAuth } from '../../hooks/useAuth';



const MyNode = () => {

    const payload = useSelector(state => state.myNodeReducer);
    const nodeReducer = useSelector(state => state.nodeReducer);
    const userReducer = useSelector(state => state.userReducer);
    const dispatch = useDispatch();

    const { user } = useAuth();

    // let numOfNode = JSON.parse(userReducer.user.object).user_detail ? JSON.parse(userReducer.user.object).user_detail.allowedNumberOfLnd : 2;
    let numOfNode = JSON.parse(user.object).user_detail ? JSON.parse(user.object).user_detail.allowedNumberOfLnd : 20;

    const getBalances = (nodeName) => {
        if (nodeReducer.nodeInfos.get(nodeName) != null){
            return nodeReducer.nodeInfos.get(nodeName).balance;
        }else if (nodeReducer.sharedNodeInfos.get(nodeName) != null){
            return nodeReducer.sharedNodeInfos.get(nodeName).balance;
        }
        return null;
    };

    const MINUTE_MS = 60000;

    useEffect(() => {

        if (nodeReducer.nodeList.length > 0) {
            const checkNode = nodeReducer.nodeList.map((item, num) => (item.status === "CREATING"));

            if (checkNode.includes(true)) {

                const interval = setInterval(() => {
                    dispatch(getSharedNodeList())
                    dispatch(getNodeList())
                }, MINUTE_MS);

                return () => clearInterval(interval); // This represents the unmount function, in which you need to clear your interval to prevent memory leaks.

            }
        }
    }, [nodeReducer]);

    useEffect(() => {
        dispatch(getSharedNodeList())
        dispatch(getNodeList())

        document.title = `LQWD | My Nodes`;
    }, []);

    return (
        <div className="container h-100">

            <div className='my-node-holder d-sm-flex justify-content-between'>
                <div className='p-2'>
                    <div className="my-node-title">
                        My Nodes
                    </div>
                    <div className="my-node-available">
                        Available nodes: max:({numOfNode})
                    </div>
                </div>
                {nodeReducer.nodeList.length == 0 ? <></>:
                <div className='p-2 d-none d-md-block'>
                    <PrimaryButton  onClick={() => dispatch(showCreateNodeModal())}
                        text='Create New Node'
                        icon={
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor"
                                 className="bi bi-plus" viewBox="0 0 16 16">
                                <path
                                    d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
                            </svg>
                        }
                    />
                </div>}
            </div>

            {nodeReducer.nodeList.length == 0 && nodeReducer.sharedNodeList.length == 0 ? <div className="h-50 d-flex align-items-center justify-content-center">
                    <EmptyNode btnText={"Create New Node"} createNodeClicked={() => dispatch(showCreateNodeModal())}></EmptyNode>
            </div>:
            <div>
                {nodeReducer.nodeInfos.size > 0 ?
                    nodeReducer.nodeList.map((item, num) => (
                    <div className="my-node" key={num}>
                        <Node selectedNode={item}
                              nodeBalance={nodeReducer.nodeInfos.get(item.nodeName) != null ? nodeReducer.nodeInfos.get(item.nodeName).balance : null}
                        />
                    </div>
                ))
                :
                  <></>
                }

                {nodeReducer.sharedNodeInfos.size > 0
                  ?
                    nodeReducer.sharedNodeList.map((item, num) => (
                  <div className="my-node" key={num}>
                      <Node selectedNode={item}
                            nodeBalance={nodeReducer.sharedNodeInfos.get(item.nodeName) != null ? nodeReducer.sharedNodeInfos.get(item.nodeName).balance: null}
                      />
                  </div>
                ))
                  :
                  <></>
                }
            </div>

            }

        </div>
    );
};


export default MyNode;
