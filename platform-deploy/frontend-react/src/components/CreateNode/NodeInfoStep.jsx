/* eslint-disable */
import React, { useEffect, useState } from "react";
import produce from 'immer';
import Input from '../Basic/Input'
import Password from '../Basic/Password'
import Select from '../Basic/Select'
import Switch from '../Basic/Switch'
import PrimaryButton from '../Buttons/PrimaryButton'
import { nodeNetworks, devNodeNetworks } from '../Node/NodeNetworks'
import Tooltip from '@mui/material/Tooltip';
import InheritButton from '../Buttons/InheritButton'
import { setNodeInfo, setActiveStep } from '../../containers/CreateNode/CreateNodeActions'

const NodeInfoStep = ({ step, goBack, dispatch }) => {

    const initialData = {
        lndNetwork: "",
        breezLnd: false,
        alias: "",
        keySendEnabled: false,
        isNonCustodial: true,
        routingNode: false,
        hybridNode: false,
    }
    const [data, setData] = useState(initialData);
    const [passphrase, setPassphrase] = useState('');

    const onAliasChanged = (value) => {
        let newData = produce(data, (draft) => {
            draft.alias = value.target.value;
        })
        setData(newData);
    }
    const onEnvironmentChanged = (value) => {
        let newData = produce(data, (draft) => {
            draft.lndNetwork = value
        })
        setData(newData);
    }
    const onHybridNodeChanged = (value) => {
        let newData = produce(data, (draft) => {
            draft.hybridNode = value.target.value
        })
        setData(newData);
    }

    const onRoutingNodeChanged = (value) => {
        let newData = produce(data, (draft) => {
            draft.routingNode = value.target.value
        })
        setData(newData);
    }
    const onkeySendEnabledChanged = (value) => {
        let newData = produce(data, (draft) => {
            draft.keySendEnabled = value.target.value
        })
        setData(newData);
    }
    const onPassphraseChanged = (value) => {
        setPassphrase(value);
    }
    const onSelfManagedNodeChanged = (value) => {
        let newData = produce(data, (draft) => {
            draft.isNonCustodial = JSON.parse(value.target.value.toLowerCase());
        })
        setData(newData);
    }

    const onContinue = () => {
        dispatch(setNodeInfo({ info: { ...data, ...(data.isNonCustodial == true && { passphrase: passphrase })}, step: 3 }));
    }

    let blockLaunch = ((data.lndNetwork === '') || (data.isNonCustodial === true && passphrase === ''))
    let blockHint = (data.lndNetwork === '' && data.isNonCustodial === true && passphrase === '') ? " Set Environment and passphrase to continue" : "Set Environment to continue";

    return (
        <div className={`create-node-node-info create-node-step-${step}`}>
            <div className='container'>
                <div className="row">
                    <div className="alias-input col-12 my-1">
                        <Input label='Alias' onChange={onAliasChanged} ></Input>
                    </div>
                    <div className="environment-select col-12 mt-1">
                        <Select
                            options={process.env.NODE_ENV == 'production' ? nodeNetworks : devNodeNetworks}
                            onChange={onEnvironmentChanged}
                            label='Environment'
                            placeholder='Choose a node environment'
                            initialValue={data.lndNetwork}
                        ></Select>
                    </div>
                    <div className="self-managed-node-switch col-12 mt-3 my-3" >
                        <Switch label='Self-Managed Node' onChange={onSelfManagedNodeChanged} initialValue={data.isNonCustodial} disabled={true}></Switch>
                    </div>
                    {(data.isNonCustodial == true) ? <div className="create-node-infostep-passphrase col-12 mb-1 py-3" style={{ background: '#F3F5F9', borderRadius: '8px' }}>
                        <Password label='Passphrase' onChange={onPassphraseChanged} ></Password>
                    </div> : <></>
                    }
                    <div className='create-node-infostep-additional-settings'>
                    <div className={process.env.NODE_ENV == 'production' ? 'd-none' : "col-12 my-3"}>
                        <Switch
                            onChange={onRoutingNodeChanged}
                            label='Routing Node'
                            description='Provides faster processing compares to regular node'
                        ></Switch>
                    </div>
                    <div className="col-12 my-3">
                        <Switch
                            onChange={onkeySendEnabledChanged}
                            label='KeySend'
                            description='Receive payment without an invoice'
                        ></Switch>
                    </div>
                    <div className={process.env.NODE_ENV == 'production' ? 'd-none' : "col-12 mt-3 mb-3"}>
                        <Switch onChange={onHybridNodeChanged} label='Hybrid Mode (Tor/Clearnet)'></Switch>
                    </div>
                    </div>
                    <div className="col-12 mb-3 d-flex justify-content-end px-3" >
                        <InheritButton text='Back' onClick={() => dispatch(setActiveStep(1))}></InheritButton>
                        <Tooltip title={blockHint} arrow placement="top">
                            <div>
                                <PrimaryButton
                                    {...(blockLaunch && { disabled: true })}
                                    className='continue-to-next-step-btn'
                                    text='Continue'
                                    onClick={onContinue}
                                />
                            </div>
                        </Tooltip>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default NodeInfoStep;

