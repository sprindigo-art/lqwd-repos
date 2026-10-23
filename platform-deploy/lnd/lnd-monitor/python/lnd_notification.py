import datetime

import requests
import os
from confluent_kafka.avro import AvroProducer
from confluent_kafka import avro


def get_schema(url):
    try:
        schema = requests.get(url)
    except Exception as e:
        print(f"Oops an error occurred when getting schema: {e}")
        return None

    if schema and schema.json()['schema']:
        return avro.loads(schema.json()['schema'])

    return None


def create_restart_email_body(info, node_data):
    return """<h1>Node Restarted</h1>
           <p>The LND with name {nodeName} which belongs to {owner} was restarted.
            See more details below</p><table><tbody>
           <tr><td>Name: </td><td>{nodeName}</td></tr>
           <tr><td>Network: </td><td>{network}</td></tr>
           <tr><td>No of pending chan: </td><td>{noPendingChan}</td></tr>
           <tr><td>No of active chan: </td><td>{noActiveChan}</td></tr>
           <tr><td>No of inactive chan: </td><td>{noInactiveChan}</td></tr>
           <tr><td>Watch tower: </td><td>{watchTower}</td></tr>
           <tr><td>Date: </td><td>{date}</td></tr>
           </tbody>
           </table>""".format(nodeName=node_data['node_name'], owner=node_data['owner'],
                              network=node_data['network'],
                              noActiveChan=info['num_active_channels'], noPendingChan=info['num_pending_channels'],
                              noInactiveChan=info['num_inactive_channels'], watchTower=node_data['watch'],
                              date=datetime.datetime.now())


def create_node_created_email_body(node_data):
    return """<h1>Node Created</h1>
           <p>New LND with name {nodeName} has been created by {owner}. 
           See more details below</p><table><tbody>
           <tr><td>Name: </td><td>{nodeName}</td></tr>
           <tr><td>Network: </td><td>{network}</td></tr>
           <tr><td>Watch tower: </td><td>{watchTower}</td></tr>
           <tr><td>Date: </td><td>{date}</td></tr>
           </tbody>
           </table>""".format(nodeName=node_data['node_name'], owner=node_data['owner'],
                              network=node_data['network'],
                              watchTower=node_data['watch'], date=datetime.datetime.now())


def create_node_shutdown_email_body(node_data):
    return """<h1>Alert!!!</h1>
           <p>LND node {nodeName} was shutdown and require a restart.
           You can restart the node from the console.
           See more details of the affected node below</p><table><tbody>
           <tr><td>Name: </td><td>{nodeName}</td></tr>
           <tr><td>Owner: </td><td>{owner}</td></tr>
           <tr><td>Network: </td><td>{network}</td></tr>
           <tr><td>Watch tower: </td><td>{watchTower}</td></tr>
           <tr><td>Date: </td><td>{date}</td></tr>
           </tbody>
           </table>""".format(nodeName=node_data['node_name'], owner=node_data['owner'],
                              network=node_data['network'],
                              watchTower=node_data['watch'], date=datetime.datetime.now())


class Notification:

    def __init__(self):
        self.producer_config = {'bootstrap.servers': os.getenv("KAFKA_HOST"),
                                'schema.registry.url': os.getenv("SCHEMA_HOST"),
                                'sasl.username': os.getenv("KAFKA_USER"),
                                'sasl.mechanism': 'PLAIN',
                                'sasl.password': os.getenv("KAFKA_PASSWORD"),
                                'security.protocol': 'SASL_PLAINTEXT'}

    def connect_producer(self):
        send_email_value = get_schema(f"{os.getenv('SCHEMA_HOST')}/subjects/send-email-value/versions/latest")
        if not send_email_value:
            exit("Schema at %s not found!")

        return AvroProducer(self.producer_config, default_value_schema=send_email_value)

    def send_restart_email(self, info, node_data):
        if info is None:
            print(
                "Restart email not sent because node info is None"
            )
            return
        email_body = create_restart_email_body(info, node_data)
        self.send_email("Node restarted", email_body)

    def send_node_created_email(self, node_data):
        email_body = create_node_created_email_body(node_data)
        self.send_email("Node created", email_body)

    def send_node_shutdown_email(self, node_data):
        email_body = create_node_shutdown_email_body(node_data)
        comma_seperated_emails = os.getenv("NOTIFICATION_EMAILS")
        recipients = []
        if comma_seperated_emails != 'NONE':
            recipient_email_addresses = comma_seperated_emails.split(",")
            for recipient in recipient_email_addresses:
                recipients.append({
                    'email': recipient,
                    'displayName': recipient,
                    'recipientType': 'BCC'
                })

        recipients.append({
            'email': node_data['owner'],
            'displayName': node_data['owner'],
            'recipientType': 'TO'
        })

        self.send_email_kafka("Node shutdown", email_body, recipients)

    def send_email(self, subject, body):
        comma_seperated_emails = os.getenv("NOTIFICATION_EMAILS")
        if comma_seperated_emails == 'NONE':
            print("No recipients set")
            return

        recipient_email_addresses = comma_seperated_emails.split(",")
        recipients = []

        for recipient in recipient_email_addresses:
            recipients.append({
                'email': recipient,
                'displayName': recipient,
                'recipientType': 'TO'
            })

        self.send_email_kafka(subject, body, recipients)

    def send_email_kafka(self, subject, body, recipients):
        email = {'body': body,
                 'subject': subject,
                 'sender': {
                     'email': 'info@lqwd.money',
                     'displayName': 'Info',
                     'recipientType': 'TO'
                 },
                 'recipients': recipients,
                 'attachments': []
                 }

        prod = self.connect_producer()
        prod.produce(topic="send-email", value=email)
        prod.flush()
