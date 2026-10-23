import os, sys

currentdir = os.path.dirname(os.path.realpath(__file__))
parentdir = os.path.dirname(currentdir)
sys.path.append(parentdir)

import unittest
from datetime import datetime
from random import randint, seed
from app.client_utils import get_schema
from app.producer import Producer


class ConsumerTest(unittest.TestCase):
    def test_message_processing(self):
        producer = Producer(True)

        # we are simulating a FE request here
        mid = randint(0, 10e8)
        timestamp = int(datetime.utcnow().timestamp())
        seed(timestamp)
        userid = randint(0, 10e6)
        nodeid = str(randint(0, 10e2))

        key = ({"id": mid, "tactionName": 'fees'})
        value = ({"id": mid, "timestamp": timestamp, "user_id": userid, "description": "description of msg",
                  "requested_action": 'fees', "node_id": nodeid})

        p = producer.connect()
        p.produce(topic='request', key=key, value=value)
        self.assertEqual(True, False)


if __name__ == '__main__':
    unittest.main()
