/* eslint-disable */
import React from 'react';
import './NodeEmpty.css';
import nodeIcon from '../../public/icons/dashboard/node.svg'
import PrimaryButton from "../Buttons/PrimaryButton";


export default function EmptyNode({createNodeClicked, btnText}) {

    return (
        <div>
            <div className="d-inline-flex justify-content-center">
                <div className="d-flex flex-column justify-content-center">
                    <div className="p-4 align-self-center">
                        <svg width="151" height="132" viewBox="0 0 151 132" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M150.5 71.5C150.5 107.951 98.9508 132 62.5 132C26.0492 132 0.5 107.951 0.5 71.5C0.5 35.0492 26.0492 0 62.5 0C98.9508 0 150.5 35.0492 150.5 71.5Z" fill="#F3F5F9"/>
                            <path d="M55.1815 62.0605L50.9395 57.8185C50.0905 56.9695 48.9595 56.5 47.758 56.5H32.5C30.8455 56.5 29.5 57.8455 29.5 59.5V74.758C29.5 75.9595 29.9695 77.0905 30.8185 77.9395L35.0605 82.1815C35.9095 83.032 37.0405 83.5 38.242 83.5H53.5C55.1545 83.5 56.5 82.1545 56.5 80.5V65.242C56.5 64.0405 56.032 62.9095 55.1815 62.0605ZM48.8185 59.9395L51.379 62.5H37.621L34.621 59.5H47.758C48.1525 59.5 48.538 59.659 48.8185 59.9395ZM32.9395 75.8185C32.659 75.538 32.5 75.1525 32.5 74.758V61.621L35.5 64.621V78.379L32.9395 75.8185Z" fill="#B7C3DA"/>
                            <path d="M119.181 62.0605L114.939 57.8185C114.09 56.9695 112.959 56.5 111.758 56.5H96.5C94.8455 56.5 93.5 57.8455 93.5 59.5V74.758C93.5 75.9595 93.9695 77.0905 94.8185 77.9395L99.0605 82.1815C99.9095 83.032 101.041 83.5 102.242 83.5H117.5C119.155 83.5 120.5 82.1545 120.5 80.5V65.242C120.5 64.0405 120.032 62.9095 119.181 62.0605ZM112.819 59.9395L115.379 62.5H101.621L98.621 59.5H111.758C112.153 59.5 112.538 59.659 112.819 59.9395ZM96.9395 75.8185C96.659 75.538 96.5 75.1525 96.5 74.758V61.621L99.5 64.621V78.379L96.9395 75.8185Z" fill="#B7C3DA"/>
                            <path d="M80 60V64H74V66H80V70L85 65L80 60ZM66 64V66H68V64H66ZM70 64V66H72V64H70ZM70 70L65 75L70 80V76H76V74H70V70ZM78 74V76H80V74H78ZM82 74V76H84V74H82Z" fill="#B7C3DA"/>
                            <path d="M45.8535 74.8535C45.756 74.951 45.628 75 45.5 75C45.372 75 45.244 74.951 45.1465 74.8535L43.1465 72.8535C42.951 72.658 42.951 72.342 43.1465 72.1465C43.342 71.951 43.658 71.951 43.8535 72.1465L45.5 73.793L49.675 69.618C48.7615 68.6255 47.4555 68 46 68C43.2385 68 41 70.2385 41 73C41 75.7615 43.2385 78 46 78C48.7615 78 51 75.7615 51 73C51 72.0575 50.7345 71.179 50.281 70.426L45.8535 74.8535Z" fill="#94A5C6"/>
                        </svg>
                    </div>
                    <div className="p-2 align-self-center desc">Create my first node to get started!</div>
                    <div className="p-2 align-self-center">
                        <PrimaryButton
                            onClick={createNodeClicked}
                            text={btnText}
                            icon={
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor"
                                     className="bi bi-plus" viewBox="0 0 16 16"><path
                                    d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
                                </svg>
                            }
                        />
                    </div>
                </div>
            </div>
        </div>
                );
}
