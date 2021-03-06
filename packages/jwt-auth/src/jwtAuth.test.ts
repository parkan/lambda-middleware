import { createContext, createEvent } from "@lambda-middleware/utils";
import {
  EncryptionAlgorithms,
  isAuthOptions,
  isAuthorizedEvent,
  jwtAuth,
} from "./jwtAuth";
import createHttpError from "http-errors";
import * as JWT from "jsonwebtoken";
import moment from "moment";

describe("exports", () => {
  it("reexports EncryptionAlgorithms", () => {
    expect(EncryptionAlgorithms).toBeDefined();
  });

  it("reexports isAuthOptions", () => {
    expect(isAuthOptions).toBeDefined();
  });

  it("reexports isAuthorizedEvent", () => {
    expect(isAuthorizedEvent).toBeDefined();
  });
});

describe("jwtAuth", () => {
  const defaultOptions = {
    algorithm: EncryptionAlgorithms.HS256,
    secretOrPublicKey: "secret",
  };

  const response = {
    statusCode: 200,
    body: "Result",
  };
  const handler = jest.fn().mockResolvedValue(response);

  beforeEach(() => {
    handler.mockClear();
  });

  it("throws a type error when defaultOptions are misformed", () => {
    expect(() => jwtAuth({} as any)).toThrowError(TypeError);
  });

  describe("without a payload type guard", () => {
    it("returns what the handler returns if token is valid", async () => {
      const token = JWT.sign({}, defaultOptions.secretOrPublicKey, {
        algorithm: defaultOptions.algorithm,
      });
      await expect(
        jwtAuth(defaultOptions)(handler)(
          createEvent({ headers: { Authorization: `Bearer ${token}` } }),
          createContext()
        )
      ).resolves.toEqual(response);
    });

    it("returns what the handler returns if token is given in lower-case authorization header", async () => {
      const token = JWT.sign({}, defaultOptions.secretOrPublicKey, {
        algorithm: defaultOptions.algorithm,
      });
      await expect(
        jwtAuth(defaultOptions)(handler)(
          createEvent({ headers: { authorization: `Bearer ${token}` } }),
          createContext()
        )
      ).resolves.toEqual(response);
    });

    it("returns what the handler returns if token is given in upper-case authorization header", async () => {
      const token = JWT.sign({}, defaultOptions.secretOrPublicKey, {
        algorithm: defaultOptions.algorithm,
      });
      await expect(
        jwtAuth(defaultOptions)(handler)(
          createEvent({ headers: { Authorization: `Bearer ${token}` } }),
          createContext()
        )
      ).resolves.toEqual(response);
    });

    it("calls the handler with token payload in event.auth.payload if token is valid", async () => {
      const data = { userId: 1 };
      const token = JWT.sign(data, defaultOptions.secretOrPublicKey, {
        algorithm: defaultOptions.algorithm,
      });
      await jwtAuth(defaultOptions)(handler)(
        createEvent({ headers: { Authorization: `Bearer ${token}` } }),
        createContext()
      );
      expect(handler.mock.calls[0][0]).toMatchObject({
        auth: {
          payload: {
            ...data,
            iat: expect.any(Number),
          },
        },
      });
    });

    it("calls the handler with token in event.auth.token if token is valid", async () => {
      const data = { userId: 1 };
      const token = JWT.sign(data, defaultOptions.secretOrPublicKey, {
        algorithm: defaultOptions.algorithm,
      });
      await jwtAuth(defaultOptions)(handler)(
        createEvent({ headers: { Authorization: `Bearer ${token}` } }),
        createContext()
      );
      expect(handler.mock.calls[0][0]).toMatchObject({
        auth: { token },
      });
    });

    it("rejects if event.auth is already filled", async () => {
      const data = { userId: 1 };
      const token = JWT.sign(data, defaultOptions.secretOrPublicKey, {
        algorithm: defaultOptions.algorithm,
      });
      await expect(
        jwtAuth(defaultOptions)(handler)(
          createEvent({
            headers: { Authorization: `Bearer ${token}` },
            auth: {},
          } as any),
          createContext()
        )
      ).rejects.toEqual(
        createHttpError(400, "The events auth property has to be empty", {
          type: "EventAuthNotEmpty",
        })
      );
    });

    it("rejects if both authorization and Authorization headers are set", async () => {
      const data = { userId: 1 };
      const token = JWT.sign(data, defaultOptions.secretOrPublicKey, {
        algorithm: defaultOptions.algorithm,
      });
      await expect(
        jwtAuth(defaultOptions)(handler)(
          createEvent({
            headers: {
              Authorization: `Bearer ${token}`,
              authorization: `Bearer ${token}`,
            },
          }),
          createContext()
        )
      ).rejects.toEqual(
        createHttpError(
          400,
          "Both authorization and Authorization headers found, only one can be set",
          {
            type: "MultipleAuthorizationHeadersSet",
          }
        )
      );
    });

    it("rejects if Authorization header is malformed", async () => {
      await expect(
        jwtAuth(defaultOptions)(handler)(
          createEvent({
            headers: {
              Authorization: "Malformed header",
            },
          }),
          createContext()
        )
      ).rejects.toEqual(
        createHttpError(
          401,
          'Format should be "Authorization: Bearer [token]", received "Authorization: Malformed header" instead',
          {
            type: "WrongAuthFormat",
          }
        )
      );
    });

    it("rejects if token is invalid", async () => {
      const token = JWT.sign({}, "wrong secret", {
        algorithm: defaultOptions.algorithm,
      });
      await expect(
        jwtAuth(defaultOptions)(handler)(
          createEvent({ headers: { Authorization: `Bearer ${token}` } }),
          createContext()
        )
      ).rejects.toEqual(
        createHttpError(401, "Invalid token", {
          type: "InvalidToken",
        })
      );
    });

    it("rejects if token is expired", async () => {
      const token = JWT.sign({ exp: 1 }, "secret", {
        algorithm: defaultOptions.algorithm,
      });
      await expect(
        jwtAuth(defaultOptions)(handler)(
          createEvent({ headers: { Authorization: `Bearer ${token}` } }),
          createContext()
        )
      ).rejects.toEqual(
        createHttpError(401, "Token expired at Thu, 01 Jan 1970 00:00:01 GMT", {
          expiredAt: new Date("Thu Jan 01 1970 01:00:01 GMT+0100 (GMT+01:00)"),
          type: "TokenExpiredError",
        })
      );
    });

    it("rejects if token isn't valid yet", async () => {
      const validDate = new Date("2100-01-01T00:00:00Z");
      const token = JWT.sign({ nbf: moment(validDate).unix() }, "secret", {
        algorithm: defaultOptions.algorithm,
      });
      await expect(
        jwtAuth(defaultOptions)(handler)(
          createEvent({ headers: { Authorization: `Bearer ${token}` } }),
          createContext()
        )
      ).rejects.toEqual(
        createHttpError(401, `Token not valid before ${validDate}`, {
          date: validDate,
          type: "NotBeforeError",
        })
      );
    });

    it("rejects if authorization is required and no authorization header is set", async () => {
      const options = {
        ...defaultOptions,
        credentialsRequired: true,
      };
      await expect(
        jwtAuth(options)(handler)(createEvent({}), createContext())
      ).rejects.toEqual(
        createHttpError(
          401,
          "No valid bearer token was set in the authorization header",
          {
            type: "AuthenticationRequired",
          }
        )
      );
    });
  });

  describe("with a payload type guard", () => {
    interface Payload {
      userId: number;
    }

    function isPayload(payload: any): payload is Payload {
      return payload != null && typeof payload.userId === "number";
    }

    const defaultOptions = {
      algorithm: EncryptionAlgorithms.HS256,
      isPayload,
      secretOrPublicKey: "secret",
    };

    it("calls the handler with token payload in event.auth.payload if token is valid", async () => {
      const data = { userId: 1 };
      const token = JWT.sign(data, defaultOptions.secretOrPublicKey, {
        algorithm: defaultOptions.algorithm,
      });
      await jwtAuth(defaultOptions)(handler)(
        createEvent({ headers: { Authorization: `Bearer ${token}` } }),
        createContext()
      );
      expect(handler.mock.calls[0][0]).toMatchObject({
        auth: {
          payload: {
            ...data,
            iat: expect.any(Number),
          },
        },
      });
    });

    it("rejects if payload doesn't pass the payload type guard", async () => {
      const data = { iat: 1, user: 1 };
      const token = JWT.sign(data, defaultOptions.secretOrPublicKey, {
        algorithm: defaultOptions.algorithm,
      });
      await expect(
        jwtAuth(defaultOptions)(handler)(
          createEvent({ headers: { Authorization: `Bearer ${token}` } }),
          createContext()
        )
      ).rejects.toEqual(
        createHttpError(
          400,
          'Token payload malformed, was {"iat":1,"user":1}',
          {
            payload: { iat: 1, user: 1 },
            type: "TokenPayloadMalformedError",
          }
        )
      );
    });

    describe("with custom tokenSources", () => {
      it("resolves successfully if no token is found", async () => {
        const options = {
          ...defaultOptions,
          tokenSource: (event: any) => event.queryStringParameters.token,
        };
        await expect(
          jwtAuth(options)(handler)(createEvent({}), createContext())
        ).resolves.toEqual(response);
      });

      it("calls the handler with token payload in event.auth.payload if token is valid", async () => {
        const options = {
          ...defaultOptions,
          tokenSource: (e: any) => e.queryStringParameters.token,
        };
        const data = { userId: 1 };
        const token = JWT.sign(data, options.secretOrPublicKey, {
          algorithm: options.algorithm,
        });
        await jwtAuth(options)(handler)(
          createEvent({
            queryStringParameters: { token },
          }),
          createContext()
        );
        expect(handler.mock.calls[0][0]).toMatchObject({
          auth: {
            payload: {
              ...data,
              iat: expect.any(Number),
            },
          },
        });
      });

      it("calls the handler with token payload in event.auth.payload if token is valid and credentials are required", async () => {
        const options = {
          ...defaultOptions,
          credentialsRequired: true,
          tokenSource: (e: any) => e.queryStringParameters.token,
        };
        const data = { userId: 1 };
        const token = JWT.sign(data, options.secretOrPublicKey, {
          algorithm: options.algorithm,
        });
        await jwtAuth(options)(handler)(
          createEvent({
            queryStringParameters: { token },
          }),
          createContext()
        );
        expect(handler.mock.calls[0][0]).toMatchObject({
          auth: {
            payload: {
              ...data,
              iat: expect.any(Number),
            },
          },
        });
      });
    });
  });
});
