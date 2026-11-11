"""Structured JSON decoding that permits Turkish prose and original source text."""
from lmformatenforcer import JsonSchemaParser, CharacterLevelParserConfig
from lmformatenforcer.consts import COMPLETE_ALPHABET
from copy import deepcopy
import json


def json_parser(schema, payload):
    alphabet = "".join(dict.fromkeys(COMPLETE_ALPHABET + "çğıöşüÇĞİÖŞÜ" + "".join(sorted(set(payload)))))
    config = CharacterLevelParserConfig(alphabet=alphabet, force_json_field_order=True)
    return JsonSchemaParser(schema, config=config)


def prefix_function(tokenizer_data, schema, payload):
    from lmformatenforcer.integrations.transformers import build_transformers_prefix_allowed_tokens_fn
    schema = deepcopy(schema)
    ids = [event["event_id"] for event in json.loads(payload)["events"]]
    schema["properties"]["events"].update(minItems=len(ids), maxItems=len(ids))
    schema["$defs"]["EventAnalysis"]["properties"]["event_id"]["enum"] = ids
    if len(ids) <= 1:
        schema['properties']['cross_event_notes']['enum'] = ['']
    function = build_transformers_prefix_allowed_tokens_fn(tokenizer_data, json_parser(schema, payload))
    # TokenEnforcer replaces parser.config with the tokenizer's full Unicode alphabet.
    # Apply ordering afterwards, preserving that alphabet and its free-text token cache.
    function.token_enforcer.root_parser.config.force_json_field_order = True
    return function
