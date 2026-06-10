declare global {
  namespace App {
    // Reserved for future session/user data; deliberately empty in Slice A.
    interface Locals {}
    interface PageData {}
    interface Error {
      message: string;
      code?: string;
    }
    interface Platform {}
  }
}

export {};
