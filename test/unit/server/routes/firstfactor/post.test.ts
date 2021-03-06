
import sinon = require("sinon");
import BluebirdPromise = require("bluebird");
import assert = require("assert");
import winston = require("winston");

import FirstFactorPost = require("../../../../../src/server/lib/routes/firstfactor/post");
import exceptions = require("../../../../../src/server/lib/Exceptions");
import AuthenticationSession = require("../../../../../src/server/lib/AuthenticationSession");
import Endpoints = require("../../../../../src/server/endpoints");

import AuthenticationRegulatorMock = require("../../mocks/AuthenticationRegulator");
import AccessControllerMock = require("../../mocks/AccessController");
import ExpressMock = require("../../mocks/express");
import ServerVariablesMock = require("../../mocks/ServerVariablesMock");
import { ServerVariables } from "../../../../../src/server/lib/ServerVariablesHandler";

describe("test the first factor validation route", function () {
  let req: ExpressMock.RequestMock;
  let res: ExpressMock.ResponseMock;
  let emails: string[];
  let groups: string[];
  let configuration;
  let regulator: AuthenticationRegulatorMock.AuthenticationRegulatorMock;
  let accessController: AccessControllerMock.AccessControllerMock;
  let serverVariables: ServerVariables;

  beforeEach(function () {
    configuration = {
      ldap: {
        base_dn: "ou=users,dc=example,dc=com",
        user_name_attribute: "uid"
      }
    };

    emails = ["test_ok@example.com"];
    groups = ["group1", "group2" ];

    accessController = AccessControllerMock.AccessControllerMock();
    accessController.isDomainAllowedForUser.returns(true);

    regulator = AuthenticationRegulatorMock.AuthenticationRegulatorMock();
    regulator.regulate.returns(BluebirdPromise.resolve());
    regulator.mark.returns(BluebirdPromise.resolve());

    req = {
      app: {
      },
      body: {
        username: "username",
        password: "password"
      },
      session: {
      },
      headers: {
        host: "home.example.com"
      }
    };

    AuthenticationSession.reset(req as any);

    serverVariables = ServerVariablesMock.mock(req.app);
    serverVariables.ldapAuthenticator = {
      authenticate: sinon.stub()
    } as any;
    serverVariables.config = configuration as any;
    serverVariables.logger = winston as any;
    serverVariables.regulator = regulator as any;
    serverVariables.accessController = accessController as any;

    res = ExpressMock.ResponseMock();
  });

  it("should redirect client to second factor page", function () {
    (serverVariables.ldapAuthenticator as any).authenticate.withArgs("username", "password")
      .returns(BluebirdPromise.resolve({
        emails: emails,
        groups: groups
      }));
    const authSession = AuthenticationSession.get(req as any);
    return FirstFactorPost.default(req as any, res as any)
      .then(function () {
        assert.equal("username", authSession.userid);
        assert.equal(Endpoints.SECOND_FACTOR_GET, res.redirect.getCall(0).args[0]);
      });
  });

  it("should retrieve email from LDAP", function () {
    (serverVariables.ldapAuthenticator as any).authenticate.withArgs("username", "password")
      .returns(BluebirdPromise.resolve([{ mail: ["test@example.com"] }]));
    return FirstFactorPost.default(req as any, res as any);
  });

  it("should set first email address as user session variable", function () {
    const emails = ["test_ok@example.com"];
    const authSession = AuthenticationSession.get(req as any);
    (serverVariables.ldapAuthenticator as any).authenticate.withArgs("username", "password")
      .returns(BluebirdPromise.resolve({
        emails: emails,
        groups: groups
      }));
    return FirstFactorPost.default(req as any, res as any)
      .then(function () {
        assert.equal("test_ok@example.com", authSession.email);
      });
  });

  it("should return status code 401 when LDAP authenticator throws", function () {
    (serverVariables.ldapAuthenticator as any).authenticate.withArgs("username", "password")
      .returns(BluebirdPromise.reject(new exceptions.LdapBindError("Bad credentials")));
    return FirstFactorPost.default(req as any, res as any)
      .then(function () {
        assert.equal(401, res.status.getCall(0).args[0]);
        assert.equal(regulator.mark.getCall(0).args[0], "username");
      });
  });

  it("should return status code 403 when regulator rejects authentication", function () {
    const err = new exceptions.AuthenticationRegulationError("Authentication regulation...");
    regulator.regulate.returns(BluebirdPromise.reject(err));
    return FirstFactorPost.default(req as any, res as any)
      .then(function () {
        assert.equal(403, res.status.getCall(0).args[0]);
        assert.equal(1, res.send.callCount);
      });
  });
});


