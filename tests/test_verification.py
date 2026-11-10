import json
from scripts.verify_persistence import canonical_json


def test_receipt_hash_matches_browser_json_numbers_after_zero_second_warmup():
    result = {'performance': {'model_wait_seconds': 0.0, 'total_seconds': 206.628,
                              'llm_seconds': 206.0}, 'report': ['Türkçe', {'value': -0.0}]}
    before = json.dumps(result)
    assert canonical_json(result) == '{"performance":{"llm_seconds":206,"model_wait_seconds":0,"total_seconds":206.628},"report":["Türkçe",{"value":0}]}'
    assert json.dumps(result) == before
