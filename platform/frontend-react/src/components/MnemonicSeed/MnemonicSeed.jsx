/* eslint-disable */
import React, { useState, useEffect } from 'react';
import produce from 'immer';
import { Modal } from 'react-bootstrap';
import PrimaryButton from "../Buttons/PrimaryButton";
import PrimaryOutlineButton from "../Buttons/PrimaryOutline";
import PrintImg from '../../public/icons/general/png/Print.png';
import CopyImg from '../../public/icons/general/png/Copy.png';
import TextPanel from '../InfoPanel/InfoPanel'
import Input from '../Basic/Input'
import BlockUi from 'react-block-ui';
import './MnemonicSeed.css';
import 'react-block-ui/style.css';
import Tooltip from "react-bootstrap/Tooltip";
import { OverlayTrigger } from "react-bootstrap";
import { useSnackbar } from "notistack";
import NotificationDuration from "../../NotificationDuration";


export default function SeedsModal({ seeds, confirmationSeedsIndexes, handleHide, handleConfirm, show }) {

    const [step, setStep] = useState(0);
    const { enqueueSnackbar, closeSnackbar } = useSnackbar();
    const [confirmationSeeds, setConfirmationSeeds] = useState([]);
    const [confirmationSeedsData, setConfirmationSeedsData] = useState([{ value: '', id: 0 }, { value: '', id: 0 }, { value: '', id: 0 }]);

    const [showCopied, setShowCopied] = useState(false);

    const renderTooltip = props => (
        <Tooltip {...props} id="copy-tooltip">Copied</Tooltip>
    );

    function copySeeds() {
        navigator.clipboard.writeText(seeds).then(r => {
            setShowCopied(true)
            setTimeout(function () { setShowCopied(false); }, 1000)
        }
        )
    }

    useEffect(() => {

        if (seeds.length == 0) {
            setStep(0);
        }
    });

    const confirm = () => {
        let error = false;
        for (let index in confirmationSeedsData) {
            if (confirmationSeedsData[index].value != seeds[confirmationSeedsData[index].id]) {
                error = true;
            }
        }

        if (error == false) {
            handleConfirm();
        } else {
            enqueueSnackbar('Incorrect Words, Please Make Sure to Copy Down in Correct Order', { variant: 'error', autoHideDuration: NotificationDuration });
        }

    }

    const seedInputChanged = (value, index, id) => {
        let newConf = produce(confirmationSeedsData, (draftState) => {
            if (confirmationSeedsData[index] == null) {
                draftState[index] = {};
            }
            draftState[index].value = value.target.value
            draftState[index].id = id
        })
        setConfirmationSeedsData(newConf);
    }

    const renderSeedRow = (offset) => {
        var cols = [];
        for (var i = 0; i < 4; i = i + 1) {
            cols.push(<td className='' key={offset + i}>{'' + (offset + i + 1) + '. ' + (seeds[offset + i] || '...')}</td>);
        }
        return (
            <tr key={offset}>
                {cols}
            </tr>
        );
    }

    const renderSeedTable = () => {
        var rows = [];
        let i = 1;
        for (i = 0; i < 6; i = i + 1) {
            rows.push(renderSeedRow(i * 4));
        }
        return (
            <tbody>
                {rows}
            </tbody>
        );
    }



    return (
        <Modal centered className="mnemonic-seeds-modal " size="md" show={show} onHide={handleHide} backdrop='static' keyboard="False">
            <Modal.Header closeButton className='border-0'>
                <h1>Mnemonic Seed</h1>
            </Modal.Header>
            <Modal.Body className='px-4'>
                <BlockUi tag="div" blocking={seeds.length == 0}>
                    <div className='d-flex flex-row my-3'>
                        <div className='d-flex flex-row'>
                            <div className={"numberCircle mx-2" + (step >= 0 ? ' done' : ' ')}>1</div>
                            <span>Copy & Store Seed</span>
                        </div>
                        <div className='d-flex flex-row'>
                            <div className={"numberCircle mx-2" + (step >= 1 ? ' done' : ' ')}>2</div>
                            <span>Confirm Seed</span>
                        </div>
                    </div>

                    {step == 0 ?
                        <div className=''>

                            <div className='my-3' id='mnemonic-seed-list-warning'>
                                <TextPanel warn={true} text="Please carefully save the seeds to run your self-managed node."></TextPanel>
                            </div>
                            <div className='my-3' id='mnemonic-seed-list'>
                                <table className="table " >
                                    {renderSeedTable()}
                                </table>
                            </div>
                            <div className='container'>
                                <div className="row">
                                    <div className="col-6 pe-1 ps-0">
                                        <PrimaryOutlineButton
                                            onClick={() => window.print()}
                                            className='w-100 justify-content-center'
                                            icon={<img src={PrintImg}></img>}
                                            text='Print Seed' />
                                    </div>
                                    <OverlayTrigger placement="top" show={showCopied} overlay={renderTooltip}>
                                        <div className="col-6 pe-0 ps-1">
                                            <PrimaryOutlineButton
                                                onClick={copySeeds}
                                                className='w-100 justify-content-center'
                                                icon={<img src={CopyImg}></img>}
                                                text='Copy Seed to Clipboard' />
                                        </div>
                                    </OverlayTrigger>
                                </div>
                            </div>
                            <div className='d-flex justify-content-end mt-4'>
                                <PrimaryButton onClick={() => setStep(1)} text='Next'></PrimaryButton>
                            </div>

                        </div>
                        :
                        <div className='my-3'>

                            <div className='container'>
                                <div className="row">
                                    {confirmationSeedsIndexes.map((item, num) => (
                                        <div className="col-12 my-1">
                                            <Input label={'Enter Word [' + (Number(item) + 1) + ']'} onChange={(val) => seedInputChanged(val, num, item)}></Input>
                                        </div>
                                    ))}

                                </div>
                            </div>

                            <div className='d-flex justify-content-between mt-4 px-2'>
                                <div className='d-flex flex-column justify-content-center' style={{ cursor: 'pointer' }} onClick={() => setStep(0)} >Back</div>
                                <PrimaryButton onClick={() => confirm(confirmationSeedsData)} text='Confirm' className='py-0'></PrimaryButton>

                            </div>
                        </div>
                    }
                </BlockUi>
            </Modal.Body>
        </Modal>
    );
}
