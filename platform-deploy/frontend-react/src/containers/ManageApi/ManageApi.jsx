/* eslint-disable */
import './ManageApi.css';
import React, { useEffect, useState } from "react";
import ReactJson from 'react-json-view'
import Select from "../../components/Basic/Select";
import PrimaryButton from "../../components/Buttons/PrimaryButton";
import CopyImg from 'public/icons/general/png/Copy.png';
import { useDispatch, useSelector } from "react-redux";
import { useSnackbar } from "notistack";
import { getManageApiNodes, sendManageApiCommand } from "./ManageApiActions";
import { CheckDataVersionAndClearIfObsolete } from "../../managers/DataManager/DataManager";
import { requestGetLatestAppVersion } from "../../requests/Login";
import { getSharedNodeList } from "../SharedNodeAccess/ShareNodeAcessActions";
import { getNodeList } from "../../managers/nodeManager/nodeActions";
import { processSelectItemNode } from "../../utils/utils";

const data = {
    "name": "John",
    "age": 22,
    "hobby": {
	"reading" : true,
	"gaming" : false,
	"sport" : "football"
    },
    "class" : ["JavaScript", "HTML", "CSS"]
}


const ManageApi = () => {

    const nodeReducer = useSelector(state => state.nodeReducer);
    const manageApiState = useSelector(state => state.manageApiReducer);
    const dispatch = useDispatch();
    const { enqueueSnackbar, closeSnackbar } = useSnackbar();

    const [lndNode, setLndNode] = useState("");
    const [command, setCommand] = useState("");

    const emptyNodes = [
      {value: '', label: 'Loading...'}
    ];

    let nodes = processSelectItemNode(nodeReducer.nodeList, false);
    let sharedNodes = processSelectItemNode(nodeReducer.sharedNodeList, true);

    nodes = nodes.concat(sharedNodes);

    const commands = [
      {value: 'getinfo', label: 'Get LND Info'},
      {value: 'channels', label: 'Channel Info'},
      {value: 'fees', label: 'Fees Info'},
      {value: 'getrecoveryinfo', label: 'Get Recovery Info'},
      {value: 'peers', label: 'Peers'},
      {value: 'balance/blockchain', label: 'Wallet Balance'},
      {value: 'balance/channels', label: 'Channel Balance'},
      {value: 'transactions', label: 'Transaction History'},
    ];

    const handleNodeSelect = (value) => {
      setLndNode(value);
    };

    const handleCommandSelect = (value) => {
      setCommand(value);
    };

    const handleCommandSubmit = (node, command) => {
      dispatch(sendManageApiCommand(node,command));
    }

    useEffect(() => {
      document.title = `LQwD | Manage API`;
      dispatch(getNodeList())
      dispatch(getSharedNodeList())
      // dispatch(getSharedNodeList())
      //update data version
      CheckDataVersionAndClearIfObsolete();

      //update application version
      requestGetLatestAppVersion()
        .then(function (response) {
          console.log(response);
          if (response.version) {
            let version = response.version;
            console.log(`version of server application is ${version}`)

            const currentAppVersion = process.env.REACT_APP_VERSION;
            if (version !== currentAppVersion) {
              console.log(`version of server application is ${version} which is different from cached version of app ${currentAppVersion}. reloading to get latest files...`)
              setTimeout(function () { window.location.reload(true); }, 500)
            }
          }
        }).catch(function (error) {
        console.log(error);
      });
    }, []);

    return (
        <div className="manage-api-container">
            <div className="manage-api-header">
              Manage API
            </div>
            <div className="manage-api-form">
              <div className="manage-api-form-row">
                {manageApiState.nodes != null}
                <Select className="manage-api-form-select" placeholder={"Select Node"}
                        options={nodes.length > 0 ? nodes : emptyNodes}
                        onChange={handleNodeSelect}></Select>
                <Select className="manage-api-form-select"
                        placeholder={"Select lncli Command"}
                        options={commands}
                        onChange={handleCommandSelect}></Select>
                <PrimaryButton text={"Submit"} onClick={() => handleCommandSubmit(lndNode, command)}></PrimaryButton>
              </div>
            </div>
            <div className="manage-api-line"></div>
            <div className="manage-api-output">
              <div className="manage-api-output-header-row">
                <div className="manage-api-output-header">Result Box</div>
                <div className="manage-api-output-copy-icon">
                  <img src={CopyImg} alt="Copy Output"/>
                </div>
              </div>
              <ReactJson src={manageApiState.commandOutput} theme="rjv-default" />
            </div>
        </div>
    );
};

export default ManageApi;

