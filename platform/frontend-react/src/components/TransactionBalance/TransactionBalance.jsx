/* eslint-disable */
import React, { useEffect } from 'react';
import './TransactionBalance.sass'
import { Line } from 'react-chartjs-2';
import inflowIcon from '../../public/icons/dashboard/inflow.svg'
import outflowIcon from '../../public/icons/dashboard/outflow.svg'
import BalanceItem from "../NodeBalance/BalanceItem";

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']

import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Filler,
    Legend
} from 'chart.js';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Filler,
    Legend,
);

ChartJS.register(
    {
        id: 'uniqueid6', //typescript crashes without id
        afterDraw: function (chart, easing) {

            if (chart.tooltip == undefined)
                return;

            if (chart.tooltip._active && chart.tooltip._active.length) {
                const activePoint = chart.tooltip._active[0];
                const ctx = chart.ctx;
                const x = activePoint.element.x;
                const topY = chart.scales.y.top;
                const bottomY = chart.scales.y.bottom;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(x, topY);
                ctx.lineTo(x, bottomY);
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
                ctx.stroke();
                ctx.restore();
            }
        }
    }
);


Tooltip.positioners.myCustomPositioner = function (elements, eventPosition) {
    // A reference to the tooltip model
    const tooltip = this;

    /* ... */

    return {
        x: eventPosition.x,
        y: 0,
        yAlign: "bottom"
    };
};

function getChartOptions(month, currency) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            tooltip: {
                position: "myCustomPositioner",
                displayColors: false,
                backgroundColor: '#ffffff',
                titleColor: '#000000',
                bodyColor: '#7A7A7A',
                caretSize: 0,
                callbacks: {
                    title: function (context) {
                        return context[0].label
                    },
                    label: function (context) {
                        return `${context.formattedValue} ${currency.code}`;
                    },
                }
            },
            legend: {
                display: false,
            },
            title: {
                display: true,
                align: 'start',
                color: '#FFFFFF',
                font: { size: 14, family: 'Inter', weight: 'normal' },
                text: `Balance history - ${month}`,
            },


        },
        interaction: {
            mode: 'index',
            intersect: false,
        },
        elements: {
            point: {
                borderWidth: 0,
                radius: 0,
                backgroundColor: 'rgba(0,0,0,0)'
            }
        },
        scales: {
            x: {
                display: false,
                gridLines: {
                    // You can change the color, the dash effect, the main axe color, etc.
                    display: false
                }
            },
            y: {
                position: 'right',
                grid: {
                    // You can change the color, the dash effect, the main axe color, etc.
                    borderDash: [8, 4],
                    color: "rgba(0, 0, 0, 0.3)"
                },
                ticks: {
                    color: "#000000", // this here
                },
            }
        }
    }
}

function getAllDaysInMonth(year, month) {
    const date = new Date(year, month, 1);

    const dates = [];

    while (date.getMonth() === month) {
        let d = new Date(date)
        let dateString = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`

        dates.push(dateString);
        date.setDate(date.getDate() + 1);
    }

    return dates;
}

function getAllDaysInYear(year) {
    const date = new Date(year, 0, 1);

    const dates = [];

    while (date.getFullYear() === year) {
        let d = new Date(date)
        let dateString = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`

        dates.push(dateString);
        date.setDate(date.getDate() + 1);
    }

    return dates;
}


const now = new Date();
function getChartData(balances1, balances2, type) {
    let labels = getAllDaysInMonth(now.getFullYear(), now.getMonth());
    switch (type) {
        case 'week':
            labels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            break;
        case 'month':
            labels = getAllDaysInMonth(now.getFullYear(), now.getMonth());
            break;
        case 'year':
            labels = getAllDaysInYear(now.getFullYear());
            break;
        default:
            labels = getAllDaysInMonth(now.getFullYear(), now.getMonth());
            break;
    }
    let b1 = JSON.parse(JSON.stringify(balances1));
    for (let i=balances1.length; i<labels.length; i++ ){
        b1.push(0);
    }
    let b2 = JSON.parse(JSON.stringify(balances2));
    for (let j=balances2.length; j<labels.length; j++ ){
        b2.push(0);
    }

    return {
        labels: labels,
        datasets: [
            {
                label: 'Dataset 1',
                borderColor: '#FFFFFF',
                data: b1,
                backgroundColor: [
                    'rgba(183, 246, 182, 0.5)',
                    'rgba(183, 246, 182, 0)',
                ],
                fill: {
                    target: 'origin'
                }
            },
            {
                label: 'Dataset 2',
                borderColor: '#FFFFFF',
                data: b2,
                backgroundColor: [
                    'rgba(255, 203, 200, 0.5)',
                ],
                fill: {
                    target: 'origin'
                }
            }
        ]
    };
}


export default function TransactionBalance({ transactionReceived, transactionSpent, currentMonth, currency, timespan, spent, received }) {

    let receivedProp = {
        balance: received,
        currency: currency,
        icon: inflowIcon,
        color: '#B7F6B6',
        title: 'Received this month'
    }

    let sentProp = {
        balance: spent,
        currency: currency,
        icon: outflowIcon,
        color: '#FFCBC8',
        title: 'Spent this month'
    }

    let chartData = getChartData(transactionReceived, transactionSpent, timespan.type);
    let chartOptions = getChartOptions(currentMonth, currency);

    return (
        <div className='transaction-balance container'>
            <div className=" d-flex flex-row">
                <div className='flex-grow-1'>
                    <BalanceItem prop={receivedProp} />
                    <BalanceItem prop={sentProp} />
                </div>
                <div>
                    <div className='d-md-flex d-none flex-column hint'>
                        <div className='d-flex my-2'>
                            <div className="receive-hint mx-1"></div>
                            Spent
                        </div>
                        <div className='d-flex my-2'>
                            <div className="spent-hint mx-1"></div>
                            Received
                        </div>
                    </div>
                </div>
            </div>
            <div className="">
                <div className="chart">
                    <Line options={chartOptions} data={chartData} />
                </div>
            </div>
        </div>
    );
}
